// The ScheduleRepository on D1 (ADR 0009).
//
// D1 binds at most 100 parameters per statement, and only `batch()` is a
// transaction. So every write here is built as statements of at most 100
// parameters each (multi-row inserts, `IN (...)` lists, cut into chunks), and
// a sync sends all of them in one `batch()`: a 200-session sync lands whole or
// not at all.
import type { CatalogSession, ScheduleRepository, SessionFilter } from "@hallway/application";
import type { PlanEntry } from "@hallway/domain";
import { and, asc, eq, getTableColumns, gte, inArray, lt, or, sql, type SQL } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import type { Database } from "../persistence/d1/database.ts";
import { lastSyncs, planEntries, sessions } from "../persistence/d1/entities/schedule.ts";

/** D1's limit on bound parameters in one statement. */
export const D1_MAX_PARAMETERS = 100;

const sessionColumns = Object.keys(getTableColumns(sessions)).length;
const entryColumns = Object.keys(getTableColumns(planEntries)).length;

export function chunk<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

type SessionRow = typeof sessions.$inferSelect;
type EntryRow = typeof planEntries.$inferSelect;

export function fromSessionRow(row: SessionRow): CatalogSession {
  const session: CatalogSession = { sessionId: row.sessionId, eventId: row.eventId, lastSeenAt: row.lastSeenAt };
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
  if (row.topics !== null) session.topics = row.topics;
  return session;
}

function toSessionRow(session: CatalogSession): SessionRow {
  return {
    eventId: session.eventId,
    sessionId: session.sessionId,
    code: session.code ?? null,
    title: session.title ?? null,
    type: session.type ?? null,
    level: session.level ?? null,
    venue: session.venue ?? null,
    room: session.room ?? null,
    startsAt: session.startsAt ?? null,
    endsAt: session.endsAt ?? null,
    isAllDay: session.isAllDay ?? null,
    speakers: session.speakers ?? null,
    topics: session.topics ?? null,
    lastSeenAt: session.lastSeenAt,
  };
}

export const fromEntryRow = (row: EntryRow): PlanEntry => ({
  attendeeId: row.attendeeId,
  sessionId: row.sessionId,
  intent: row.intent,
  source: row.source,
  hidden: row.hidden,
  addedAt: row.addedAt,
});

/** Start order, unplaced last, then code, then id: the order the port promises. */
const sessionOrder = [
  sql`${sessions.startsAt} is null`,
  asc(sessions.startsAt),
  sql`${sessions.code} is null`,
  asc(sessions.code),
  asc(sessions.sessionId),
];

/** Every stored column but the key comes from the incoming row: it is already merged forward. */
const replaceSession = Object.fromEntries(
  Object.entries(getTableColumns(sessions))
    .filter(([key]) => key !== "eventId" && key !== "sessionId")
    .map(([key, column]) => [key, sql.raw(`excluded.\`${column.name}\``)]),
);

export function scheduleOnD1(db: Database): ScheduleRepository {
  const entryKey = (attendeeId: string, eventId: string) =>
    and(eq(planEntries.attendeeId, attendeeId), eq(planEntries.eventId, eventId));

  return {
    async session(eventId, sessionId) {
      const [row] = await db
        .select()
        .from(sessions)
        .where(and(eq(sessions.eventId, eventId), eq(sessions.sessionId, sessionId)))
        .limit(1);
      return row && fromSessionRow(row);
    },

    async sessions(eventId, sessionIds) {
      const reads = chunk([...new Set(sessionIds)], D1_MAX_PARAMETERS - 1).map((ids) =>
        db
          .select()
          .from(sessions)
          .where(and(eq(sessions.eventId, eventId), inArray(sessions.sessionId, ids))),
      );
      return (await Promise.all(reads)).flat().map(fromSessionRow);
    },

    async searchSessions(eventId, filter: SessionFilter) {
      const conditions: (SQL | undefined)[] = [eq(sessions.eventId, eventId)];
      if (filter.q !== undefined) {
        // instr, not LIKE, so `%` and `_` in the query are plain characters.
        const needle = filter.q.toLowerCase();
        conditions.push(
          or(
            sql`instr(lower(coalesce(${sessions.code}, '')), ${needle}) > 0`,
            sql`instr(lower(coalesce(${sessions.title}, '')), ${needle}) > 0`,
            sql`instr(lower(coalesce(${sessions.speakers}, '')), ${needle}) > 0`,
          ),
        );
      }
      if (filter.startsFrom !== undefined) conditions.push(gte(sessions.startsAt, filter.startsFrom));
      if (filter.startsBefore !== undefined) conditions.push(lt(sessions.startsAt, filter.startsBefore));
      const rows = await db
        .select()
        .from(sessions)
        .where(and(...conditions))
        .orderBy(...sessionOrder)
        .limit(filter.limit);
      return rows.map(fromSessionRow);
    },

    async entry(attendeeId, eventId, sessionId) {
      const [row] = await db
        .select()
        .from(planEntries)
        .where(and(entryKey(attendeeId, eventId), eq(planEntries.sessionId, sessionId)))
        .limit(1);
      return row && fromEntryRow(row);
    },

    async entries(attendeeId, eventId) {
      const rows = await db.select().from(planEntries).where(entryKey(attendeeId, eventId));
      return rows.map(fromEntryRow);
    },

    async schedule(attendeeId, eventId) {
      const rows = await db
        .select()
        .from(planEntries)
        .innerJoin(
          sessions,
          and(eq(sessions.eventId, planEntries.eventId), eq(sessions.sessionId, planEntries.sessionId)),
        )
        .where(entryKey(attendeeId, eventId))
        .orderBy(...sessionOrder);
      return rows.map((row) => ({ entry: fromEntryRow(row.plan_entries), session: fromSessionRow(row.sessions) }));
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

    async applySync(write) {
      const { attendeeId, eventId } = write;
      // Order matters: sessions before the entries that reference them. The
      // last sync is recorded first, so a batch that fails anywhere after it
      // takes the new record down with it.
      const recordSync = db
        .insert(lastSyncs)
        .values({ attendeeId, eventId, ...write.lastSync })
        .onConflictDoUpdate({ target: [lastSyncs.attendeeId, lastSyncs.eventId], set: write.lastSync });
      const statements: BatchItem<"sqlite">[] = [
        ...chunk(write.sessions.map(toSessionRow), Math.floor(D1_MAX_PARAMETERS / sessionColumns)).map((rows) =>
          db
            .insert(sessions)
            .values(rows)
            .onConflictDoUpdate({ target: [sessions.eventId, sessions.sessionId], set: replaceSession }),
        ),
        ...chunk(write.remove, D1_MAX_PARAMETERS - 2).map((ids) =>
          db.delete(planEntries).where(and(entryKey(attendeeId, eventId), inArray(planEntries.sessionId, ids))),
        ),
        ...(["interested", "reserved"] as const).flatMap((intent) =>
          chunk(
            write.update.filter((entry) => entry.intent === intent).map((entry) => entry.sessionId),
            D1_MAX_PARAMETERS - 3,
          ).map((ids) =>
            db
              .update(planEntries)
              .set({ intent })
              .where(and(entryKey(attendeeId, eventId), inArray(planEntries.sessionId, ids))),
          ),
        ),
        ...chunk(write.add, Math.floor(D1_MAX_PARAMETERS / entryColumns)).map((entries) =>
          db.insert(planEntries).values(entries.map((entry) => ({ ...entry, eventId }))),
        ),
      ];
      await db.batch([recordSync, ...statements]);
    },

    async addEntry(eventId, entry) {
      await db
        .insert(planEntries)
        .values({ ...entry, eventId })
        .onConflictDoNothing();
    },

    async removeEntry(attendeeId, eventId, sessionId) {
      await db.delete(planEntries).where(and(entryKey(attendeeId, eventId), eq(planEntries.sessionId, sessionId)));
    },

    async setHidden(attendeeId, eventId, sessionId, hidden) {
      await db
        .update(planEntries)
        .set({ hidden })
        .where(and(entryKey(attendeeId, eventId), eq(planEntries.sessionId, sessionId)));
    },
  };
}
