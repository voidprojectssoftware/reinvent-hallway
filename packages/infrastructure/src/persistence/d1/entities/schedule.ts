// The session catalog and plan entries (Drizzle models). There is no abstract
// column, and there must never be one (ADR 0003): the abstract is AWS's
// content behind a login, and the session link is how people read it.
//
// Plan entries carry the attendee's id without a foreign key: the attendees
// table belongs to the identity slice, which may land after this one.
import { sql } from "drizzle-orm";
import { check, foreignKey, index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { events } from "./events.ts";

export const sessions = sqliteTable(
  "sessions",
  {
    eventId: text("event_id")
      .notNull()
      .references(() => events.eventId),
    sessionId: text("session_id").notNull(),
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
    lastSeenAt: text("last_seen_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.eventId, table.sessionId] }),
    index("sessions_by_start").on(table.eventId, table.startsAt),
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
    hidden: integer("hidden", { mode: "boolean" }).notNull().default(false),
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
