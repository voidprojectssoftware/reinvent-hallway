// The ScheduleRepository on D1 (ADRs 0009, 0011, 0016).
//
// D1 binds at most 100 parameters per statement, and only `batch()` is a
// transaction. A sync is therefore one `batch()`, and its rows go in as JSON
// arrays expanded with `json_each` (ADR 0011), so a 1,000-session sync is
// still a handful of statements.
//
// The batch is computed from the sync alone, never from rows read before it
// (ADR 0016): "delete my synced entries not in this list, then upsert this
// list" leaves exactly what one sync sent even when two run at once, and the
// catalog row of each reported session is recomputed from all its reports in
// SQL, inside the batch, so a concurrent report is never lost.
import type { CatalogSession, ScheduleRepository, SessionFilter } from "@hallway/application";
import {
  foldSpeakers,
  foldText,
  manualIntent,
  sessionTags,
  type PlanEntry,
  type SessionReport,
  type SyncedSession,
} from "@hallway/domain";
import { and, asc, eq, getTableColumns, gte, lt, or, sql, type SQL } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";
import type { Database } from "../persistence/d1/database.ts";
import {
  hiddenSessions,
  lastSyncs,
  planEntries,
  sessionReports,
  sessions,
} from "../persistence/d1/entities/schedule.ts";

/** D1's limit on bound parameters in one statement. */
export const D1_MAX_PARAMETERS = 100;

/**
 * How much row JSON one statement binds: a quarter of D1's 2 MB limit on one
 * string, as for contacts (ADR 0011). A 250-session sync with abstracts and
 * every list is about two chunks (ADR 0025).
 */
export const syncBytesPerStatement = 500_000;

/** Rows as JSON arrays of objects, cut so no chunk's JSON passes `maxBytes`. */
export function jsonChunks(rows: readonly object[], maxBytes: number): string[] {
  const encoder = new TextEncoder();
  const chunks: string[] = [];
  let current: string[] = [];
  let bytes = 2;
  for (const row of rows) {
    const json = JSON.stringify(row);
    const size = encoder.encode(json).length + 1;
    if (current.length > 0 && bytes + size > maxBytes) {
      chunks.push(`[${current.join(",")}]`);
      current = [];
      bytes = 2;
    }
    current.push(json);
    bytes += size;
  }
  if (current.length > 0) chunks.push(`[${current.join(",")}]`);
  return chunks;
}

/**
 * `select` of every column of `table`, in the model's order, from a JSON array
 * of objects keyed by column name: the shape `insert(table).select()` wants.
 * `where true` is SQLite's own advice for an INSERT ... SELECT followed by
 * ON CONFLICT, which would otherwise parse as a join's ON.
 */
function selectFromJson(table: SQLiteTable, json: string): SQL {
  const columns = Object.values(getTableColumns(table)).map((column) =>
    sql.raw(`json_extract(value, '$.${column.name}')`),
  );
  return sql`select ${sql.join(columns, sql`, `)} from json_each(${json}) where true`;
}

/** `(select value from json_each(?))`: any number of ids as one parameter (ADR 0011). */
const jsonList = (ids: readonly string[]) => sql`(select value from json_each(${JSON.stringify([...new Set(ids)])}))`;

type SessionRow = typeof sessions.$inferSelect;
type ReportRow = typeof sessionReports.$inferSelect;
type EntryRow = typeof planEntries.$inferSelect;

/**
 * Every column of the catalog row but the abstract: what every read of a
 * session selects, so the abstract is neither carried nor fetched by a
 * schedule, a search or a feed (ADR 0025). Only `abstracts` reads it.
 */
export const catalogColumns = (({ abstract: _abstract, ...columns }) => columns)(getTableColumns(sessions));
type CatalogRow = Omit<SessionRow, "abstract">;

/** The session fields of a catalog row or a report, absent where the column is null. Never the abstract. */
function sessionFrom(row: CatalogRow | ReportRow) {
  const session: Omit<CatalogSession, "lastSeenAt"> = { sessionId: row.sessionId, eventId: row.eventId };
  if (row.code !== null) session.code = row.code;
  if (row.title !== null) session.title = row.title;
  if (row.type !== null) session.type = row.type;
  if (row.level !== null) session.level = row.level;
  if (row.venue !== null) session.venue = row.venue;
  if (row.room !== null) session.room = row.room;
  if (row.startsAt !== null) session.startsAt = row.startsAt;
  if (row.endsAt !== null) session.endsAt = row.endsAt;
  if (row.isAllDay !== null) session.isAllDay = row.isAllDay;
  if (row.speakers !== null) session.speakers = row.speakers;
  for (const tag of sessionTags) {
    const values = row[tag];
    if (values !== null) session[tag] = values;
  }
  return session;
}

export const fromSessionRow = (row: CatalogRow): CatalogSession => ({ ...sessionFrom(row), lastSeenAt: row.lastSeenAt });

/** A report's column name for each descriptive list (`areasOfInterest` is `areas_of_interest`). */
const tagColumn = (tag: (typeof sessionTags)[number]) => getTableColumns(sessionReports)[tag].name;

/**
 * A report as a JSON row for `selectFromJson(sessionReports)`, its search text
 * folded on the way. An absent field is left out rather than written as null
 * (`json_extract` reads a missing key as NULL either way), which keeps a
 * large sync's chunks small.
 */
const reportJson = (report: SessionReport): Record<string, unknown> =>
  Object.fromEntries(Object.entries(reportColumns(report)).filter(([, value]) => value !== null));
const reportColumns = (report: SessionReport): Record<string, unknown> => ({
  event_id: report.eventId,
  session_id: report.sessionId,
  attendee_id: report.attendeeId,
  reported_at: report.reportedAt,
  code: report.code ?? null,
  title: report.title ?? null,
  type: report.type ?? null,
  level: report.level ?? null,
  venue: report.venue ?? null,
  room: report.room ?? null,
  starts_at: report.startsAt ?? null,
  ends_at: report.endsAt ?? null,
  is_all_day: report.isAllDay ?? null,
  speakers: report.speakers ?? null,
  abstract: report.abstract ?? null,
  ...Object.fromEntries(sessionTags.map((tag) => [tagColumn(tag), report[tag] ?? null])),
  code_folded: report.code === undefined ? null : foldText(report.code),
  title_folded: report.title === undefined ? null : foldText(report.title),
  speakers_folded: report.speakers === undefined ? null : foldSpeakers(report.speakers),
  // Only the placeholder catalog row reads this one (selectFromJson(sessions)).
  last_seen_at: report.reportedAt,
});

/** An entry row, with whether its session is in the attendee's hidden set. */
export const fromEntryRow = (row: EntryRow, hidden: boolean): PlanEntry => ({
  attendeeId: row.attendeeId,
  sessionId: row.sessionId,
  intent: row.intent,
  source: row.source,
  invited: row.invited,
  hidden,
  addedAt: row.addedAt,
});

/**
 * The left join that says whether an entry is hidden: its session is in the
 * owner's hidden set for the event (domain.md "Visibility"). Every read of
 * entries, the network's included, joins through this.
 */
export const hiddenJoin = and(
  eq(hiddenSessions.attendeeId, planEntries.attendeeId),
  eq(hiddenSessions.eventId, planEntries.eventId),
  eq(hiddenSessions.sessionId, planEntries.sessionId),
);
export const isHidden = sql<boolean>`${hiddenSessions.sessionId} is not null`.mapWith(Boolean);

/** Start order, unplaced last, then code, then id: the order the port promises. */
const sessionOrder = [
  sql`${sessions.startsAt} is null`,
  asc(sessions.startsAt),
  sql`${sessions.code} is null`,
  asc(sessions.code),
  asc(sessions.sessionId),
];

/** Every column but the key comes from the incoming row. */
const replaceAllBut = (table: SQLiteTable, keys: readonly string[]) =>
  Object.fromEntries(
    Object.entries(getTableColumns(table))
      .filter(([key]) => !keys.includes(key))
      .map(([key, column]) => [key, sql.raw(`excluded.\`${column.name}\``)]),
  );

/**
 * The domain's `consensus`, in SQL, for the catalog row being updated: per
 * field, the value most of the session's reports carry, a tie going to the
 * value with the newest report. `group` is the columns one vote is cast on
 * (a start and its end together), and `target` the column to take from the
 * winning group. Raw names, with an alias, because in an UPDATE Drizzle
 * writes columns unqualified and `event_id` would bind to the inner table.
 */
function voted(target: string, group: readonly string[], aggregate = false): SQL {
  const value = aggregate ? `max(r.${target})` : `r.${target}`;
  const groupBy = group.map((column) => `r.${column}`).join(", ");
  return sql.raw(
    `(select ${value} from session_reports r` +
      ` where r.event_id = sessions.event_id and r.session_id = sessions.session_id and r.${group[0]} is not null` +
      ` group by ${groupBy} order by count(*) desc, max(r.reported_at) desc, ${groupBy} limit 1)`,
  );
}

const consensusColumns: Partial<Record<keyof SessionRow, SQL>> = {
  code: voted("code", ["code"]),
  // Folded text follows its own field's winner. Within one group it is the
  // same text folded the same way, except rows the 0008 migration backfilled
  // with SQLite's lower(); max() picks one either way.
  codeFolded: voted("code_folded", ["code"], true),
  title: voted("title", ["title"]),
  titleFolded: voted("title_folded", ["title"], true),
  type: voted("type", ["type"]),
  level: voted("level", ["level"]),
  venue: voted("venue", ["venue"]),
  room: voted("room", ["room"]),
  isAllDay: voted("is_all_day", ["is_all_day"]),
  speakers: voted("speakers", ["speakers"]),
  speakersFolded: voted("speakers_folded", ["speakers"], true),
  abstract: voted("abstract", ["abstract"]),
  ...Object.fromEntries(sessionTags.map((tag) => [tag, voted(tagColumn(tag), [tagColumn(tag)])])),
  startsAt: voted("starts_at", ["starts_at", "ends_at"]),
  endsAt: voted("ends_at", ["starts_at", "ends_at"]),
  lastSeenAt: sql.raw(
    "(select max(r.reported_at) from session_reports r where r.event_id = sessions.event_id and r.session_id = sessions.session_id)",
  ),
};

/** A synced session as a JSON row for `selectFromJson(planEntries)`. */
const syncedJson = (attendeeId: string, eventId: string, at: string) => (synced: SyncedSession) => ({
  attendee_id: attendeeId,
  event_id: eventId,
  session_id: synced.sessionId,
  intent: synced.intent,
  source: "agent-sync",
  invited: synced.invited,
  added_at: at,
});

export function scheduleOnD1(db: Database): ScheduleRepository {
  const entryKey = (attendeeId: string, eventId: string) =>
    and(eq(planEntries.attendeeId, attendeeId), eq(planEntries.eventId, eventId));
  const entriesWithHidden = () =>
    db.select({ entry: planEntries, hidden: isHidden }).from(planEntries).leftJoin(hiddenSessions, hiddenJoin);

  return {
    async session(eventId, sessionId) {
      const [row] = await db
        .select(catalogColumns)
        .from(sessions)
        .where(and(eq(sessions.eventId, eventId), eq(sessions.sessionId, sessionId)))
        .limit(1);
      return row && fromSessionRow(row);
    },

    async sessions(eventId, sessionIds) {
      const rows = await db
        .select(catalogColumns)
        .from(sessions)
        .where(and(eq(sessions.eventId, eventId), sql`${sessions.sessionId} in ${jsonList(sessionIds)}`));
      return rows.map(fromSessionRow);
    },

    async searchSessions(eventId, filter: SessionFilter) {
      const conditions: (SQL | undefined)[] = [eq(sessions.eventId, eventId)];
      if (filter.q !== undefined) {
        // instr, not LIKE, so `%` and `_` in the query are plain characters.
        const needle = foldText(filter.q);
        conditions.push(
          or(
            sql`instr(coalesce(${sessions.codeFolded}, ''), ${needle}) > 0`,
            sql`instr(coalesce(${sessions.titleFolded}, ''), ${needle}) > 0`,
            sql`instr(coalesce(${sessions.speakersFolded}, ''), ${needle}) > 0`,
          ),
        );
      }
      if (filter.startsFrom !== undefined) conditions.push(gte(sessions.startsAt, filter.startsFrom));
      if (filter.startsBefore !== undefined) conditions.push(lt(sessions.startsAt, filter.startsBefore));
      if (filter.type !== undefined) conditions.push(eq(sessions.type, filter.type));
      if (filter.level !== undefined) conditions.push(eq(sessions.level, filter.level));
      for (const [list, value] of [
        [sessions.topics, filter.topic],
        [sessions.tracks, filter.track],
        [sessions.services, filter.service],
      ] as const) {
        if (value !== undefined) conditions.push(sql`exists (select 1 from json_each(${list}) where value = ${value})`);
      }
      const rows = await db
        .select(catalogColumns)
        .from(sessions)
        .where(and(...conditions))
        .orderBy(...sessionOrder)
        .limit(filter.limit);
      return rows.map(fromSessionRow);
    },

    async reports(attendeeId, eventId, sessionIds) {
      if (sessionIds.length === 0) return [];
      const rows = await db
        .select()
        .from(sessionReports)
        .where(
          and(
            eq(sessionReports.attendeeId, attendeeId),
            eq(sessionReports.eventId, eventId),
            sql`${sessionReports.sessionId} in ${jsonList(sessionIds)}`,
          ),
        );
      return rows.map((row) => {
        const report: SessionReport = { ...sessionFrom(row), attendeeId: row.attendeeId, reportedAt: row.reportedAt };
        if (row.abstract !== null) report.abstract = row.abstract;
        return report;
      });
    },

    async hasReported(attendeeId, eventId) {
      const [row] = await db
        .select({ one: sql`1` })
        .from(sessionReports)
        .where(and(eq(sessionReports.attendeeId, attendeeId), eq(sessionReports.eventId, eventId)))
        .limit(1);
      return row !== undefined;
    },

    async abstracts(eventId, sessionIds) {
      if (sessionIds.length === 0) return new Map();
      const rows = await db
        .select({ sessionId: sessions.sessionId, abstract: sessions.abstract })
        .from(sessions)
        .where(
          and(
            eq(sessions.eventId, eventId),
            sql`${sessions.sessionId} in ${jsonList(sessionIds)}`,
            sql`${sessions.abstract} is not null`,
          ),
        );
      return new Map(rows.map((row) => [row.sessionId, row.abstract!]));
    },

    async entry(attendeeId, eventId, sessionId) {
      const [row] = await entriesWithHidden()
        .where(and(entryKey(attendeeId, eventId), eq(planEntries.sessionId, sessionId)))
        .limit(1);
      return row && fromEntryRow(row.entry, row.hidden);
    },

    async entries(attendeeId, eventId) {
      const rows = await entriesWithHidden().where(entryKey(attendeeId, eventId));
      return rows.map((row) => fromEntryRow(row.entry, row.hidden));
    },

    async schedule(attendeeId, eventId) {
      const rows = await db
        .select({ entry: planEntries, session: catalogColumns, hidden: isHidden })
        .from(planEntries)
        .innerJoin(
          sessions,
          and(eq(sessions.eventId, planEntries.eventId), eq(sessions.sessionId, planEntries.sessionId)),
        )
        .leftJoin(hiddenSessions, hiddenJoin)
        .where(entryKey(attendeeId, eventId))
        .orderBy(...sessionOrder);
      return rows.map((row) => ({ entry: fromEntryRow(row.entry, row.hidden), session: fromSessionRow(row.session) }));
    },

    async lastSync(attendeeId, eventId) {
      const [row] = await db
        .select()
        .from(lastSyncs)
        .where(and(eq(lastSyncs.attendeeId, attendeeId), eq(lastSyncs.eventId, eventId)))
        .limit(1);
      if (!row) return undefined;
      const { attendeeId: _attendee, eventId: _event, ...lastSync } = row;
      return lastSync;
    },

    async applySync({ attendeeId, eventId, reports, synced, at, lastSync }) {
      // The last sync is recorded first, so a batch that fails anywhere after
      // it takes the new record down with it.
      const statements: BatchItem<"sqlite">[] = [
        db
          .insert(lastSyncs)
          .values({ attendeeId, eventId, ...lastSync })
          .onConflictDoUpdate({ target: [lastSyncs.attendeeId, lastSyncs.eventId], set: lastSync }),
      ];

      if (reports.length > 0) {
        const reportChunks = jsonChunks(reports.map(reportJson), syncBytesPerStatement);
        statements.push(
          // A session new to the catalog gets its row first, for the reports'
          // foreign key; the consensus below overwrites it either way.
          ...reportChunks.map((json) => db.insert(sessions).select(selectFromJson(sessions, json)).onConflictDoNothing()),
          ...reportChunks.map((json) =>
            db
              .insert(sessionReports)
              .select(selectFromJson(sessionReports, json))
              .onConflictDoUpdate({
                target: [sessionReports.eventId, sessionReports.sessionId, sessionReports.attendeeId],
                set: replaceAllBut(sessionReports, ["eventId", "sessionId", "attendeeId"]),
              }),
          ),
          db
            .update(sessions)
            .set(consensusColumns)
            .where(
              and(
                eq(sessions.eventId, eventId),
                sql`${sessions.sessionId} in ${jsonList(reports.map((report) => report.sessionId))}`,
              ),
            ),
        );
      }

      // The entries: exactly what was sent, whatever is there now. The two
      // CASEs are the domain's `manualAfterSync`: a manual entry is reserved
      // while this sync says reserved, and the attendee's own intent otherwise.
      const sentIds = jsonList(synced.map((session) => session.sessionId));
      const mine = entryKey(attendeeId, eventId);
      statements.push(
        db.delete(planEntries).where(and(mine, eq(planEntries.source, "agent-sync"), sql`${planEntries.sessionId} not in ${sentIds}`)),
        db
          .update(planEntries)
          .set({ intent: manualIntent, invited: false })
          .where(and(mine, eq(planEntries.source, "manual"), sql`${planEntries.sessionId} not in ${sentIds}`)),
        ...jsonChunks(synced.map(syncedJson(attendeeId, eventId, at)), syncBytesPerStatement).map((json) =>
          db
            .insert(planEntries)
            .select(selectFromJson(planEntries, json))
            .onConflictDoUpdate({
              target: [planEntries.attendeeId, planEntries.eventId, planEntries.sessionId],
              set: {
                intent: sql.raw(
                  `case when plan_entries.source = 'manual' and excluded.intent <> 'reserved' then '${manualIntent}' else excluded.intent end`,
                ),
                invited: sql.raw(
                  "case when plan_entries.source = 'manual' and excluded.intent <> 'reserved' then 0 else excluded.invited end",
                ),
              },
            }),
        ),
      );
      const [first, ...rest] = statements;
      await db.batch([first!, ...rest]);
    },

    async addEntry(eventId, entry) {
      const { hidden: _hidden, ...row } = entry;
      await db
        .insert(planEntries)
        .values({ ...row, eventId })
        .onConflictDoNothing();
    },

    async removeEntry(attendeeId, eventId, sessionId) {
      await db.delete(planEntries).where(and(entryKey(attendeeId, eventId), eq(planEntries.sessionId, sessionId)));
    },

    async setHidden(attendeeId, eventId, sessionId, hidden) {
      if (hidden) {
        await db.insert(hiddenSessions).values({ attendeeId, eventId, sessionId }).onConflictDoNothing();
      } else {
        await db
          .delete(hiddenSessions)
          .where(
            and(
              eq(hiddenSessions.attendeeId, attendeeId),
              eq(hiddenSessions.eventId, eventId),
              eq(hiddenSessions.sessionId, sessionId),
            ),
          );
      }
    },
  };
}
