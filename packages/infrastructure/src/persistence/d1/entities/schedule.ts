// The session catalog, its reports, plan entries and hidden sessions (Drizzle
// models). There is no abstract column, and there must never be one (ADR
// 0003): the abstract is AWS's content behind a login, and the session link
// is how people read it.
//
// Plan entries, reports and hidden sessions carry the attendee's id without a
// foreign key: the attendees table belongs to the identity slice, which may
// land after this one.
import { sql } from "drizzle-orm";
import { check, foreignKey, index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { events } from "./events.ts";

/** What a session is, as the catalog row and each report hold it. */
const sessionFields = () => ({
  code: text("code"),
  title: text("title"),
  type: text("type"),
  level: text("level"),
  venue: text("venue"),
  room: text("room"),
  /** UTC instants as `toISOString` writes them, so they sort and compare as text. */
  startsAt: text("starts_at"),
  endsAt: text("ends_at"),
  isAllDay: integer("is_all_day", { mode: "boolean" }),
  speakers: text("speakers", { mode: "json" }).$type<string[]>(),
  topics: text("topics", { mode: "json" }).$type<string[]>(),
  // The code, title and speakers through the domain's `foldText`, written
  // with the session so search compares folded text on both sides in SQL
  // (SQLite's own lower() folds ASCII only).
  codeFolded: text("code_folded"),
  titleFolded: text("title_folded"),
  speakersFolded: text("speakers_folded"),
});

export const sessions = sqliteTable(
  "sessions",
  {
    eventId: text("event_id")
      .notNull()
      .references(() => events.eventId),
    sessionId: text("session_id").notNull(),
    ...sessionFields(),
    /** The newest report of the session. */
    lastSeenAt: text("last_seen_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.eventId, table.sessionId] }),
    index("sessions_by_start").on(table.eventId, table.startsAt),
  ],
);

/**
 * Each attendee's account of a session (ADR 0016): their agent's snapshots of
 * it, merged forward. A sync writes the reporter's row and then makes the
 * `sessions` row the consensus of all of a session's reports, in the same
 * batch, so reading a session never touches this table.
 */
export const sessionReports = sqliteTable(
  "session_reports",
  {
    eventId: text("event_id").notNull(),
    sessionId: text("session_id").notNull(),
    attendeeId: text("attendee_id").notNull(),
    reportedAt: text("reported_at").notNull(),
    ...sessionFields(),
  },
  (table) => [
    primaryKey({ columns: [table.eventId, table.sessionId, table.attendeeId] }),
    foreignKey({
      columns: [table.eventId, table.sessionId],
      foreignColumns: [sessions.eventId, sessions.sessionId],
    }),
    // An attendee's own reports, read before their next sync merges into them.
    index("session_reports_by_attendee").on(table.attendeeId, table.eventId),
  ],
);

export const planEntries = sqliteTable(
  "plan_entries",
  {
    attendeeId: text("attendee_id").notNull(),
    eventId: text("event_id").notNull(),
    sessionId: text("session_id").notNull(),
    intent: text("intent", { enum: ["interested", "reserved"] }).notNull(),
    source: text("source", { enum: ["agent-sync", "manual"] }).notNull(),
    /** The latest sync had it from AWS `invitedSessions`. */
    invited: integer("invited", { mode: "boolean" }).notNull().default(false),
    addedAt: text("added_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.attendeeId, table.eventId, table.sessionId] }),
    foreignKey({
      columns: [table.eventId, table.sessionId],
      foreignColumns: [sessions.eventId, sessions.sessionId],
    }),
    // "Who is going" reads entries by session, across attendees.
    index("plan_entries_by_session").on(table.eventId, table.sessionId),
    check("plan_entries_intent", sql`${table.intent} in ('interested', 'reserved')`),
    check("plan_entries_source", sql`${table.source} in ('agent-sync', 'manual')`),
  ],
);

/**
 * The sessions an attendee hid, per event (domain.md "Visibility"). A
 * preference kept apart from plan entries: an entry is hidden while its
 * session is here, so hiding outlives the entry leaving a sync and coming back.
 */
export const hiddenSessions = sqliteTable(
  "hidden_sessions",
  {
    attendeeId: text("attendee_id").notNull(),
    eventId: text("event_id")
      .notNull()
      .references(() => events.eventId),
    sessionId: text("session_id").notNull(),
  },
  (table) => [primaryKey({ columns: [table.attendeeId, table.eventId, table.sessionId] })],
);

/**
 * What each attendee's last sync for an event did. One row per attendee and
 * event, replaced inside the sync's own batch (ADR 0009), so it changes only
 * when a sync lands. No foreign key to attendees, as with plan entries.
 */
export const lastSyncs = sqliteTable(
  "last_syncs",
  {
    attendeeId: text("attendee_id").notNull(),
    eventId: text("event_id")
      .notNull()
      .references(() => events.eventId),
    syncedAt: text("synced_at").notNull(),
    added: integer("added").notNull(),
    removed: integer("removed").notNull(),
    changed: integer("changed").notNull(),
    unchanged: integer("unchanged").notNull(),
    missingSessions: integer("missing_sessions").notNull(),
  },
  (table) => [primaryKey({ columns: [table.attendeeId, table.eventId] })],
);
