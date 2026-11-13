import type { CatalogSession, ScheduleRepository } from "@hallway/application";
import type { PlanEntry } from "@hallway/domain";

/** The fake: answers as the D1 repository does (schedule-repository.test.ts holds both to it). */
export function scheduleInMemory(): ScheduleRepository {
  const catalog = new Map<string, CatalogSession>();
  const plans = new Map<string, PlanEntry>();
  const sessionKey = (eventId: string, sessionId: string) => JSON.stringify([eventId, sessionId]);
  const entryKey = (attendeeId: string, eventId: string, sessionId: string) =>
    JSON.stringify([attendeeId, eventId, sessionId]);
  const eventOf = new Map<string, string>();

  const sessionsOf = (eventId: string) => [...catalog.values()].filter((s) => s.eventId === eventId);
  const entriesOf = (attendeeId: string, eventId: string) =>
    [...plans.entries()]
      .filter(([key, entry]) => entry.attendeeId === attendeeId && eventOf.get(key) === eventId)
      .map(([, entry]) => entry);
  const putEntry = (eventId: string, entry: PlanEntry) => {
    const key = entryKey(entry.attendeeId, eventId, entry.sessionId);
    plans.set(key, structuredClone(entry));
    eventOf.set(key, eventId);
  };

  return {
    async session(eventId, sessionId) {
      const session = catalog.get(sessionKey(eventId, sessionId));
      return session && structuredClone(session);
    },

    async sessions(eventId, sessionIds) {
      return [...new Set(sessionIds)].flatMap((id) => {
        const session = catalog.get(sessionKey(eventId, id));
        return session ? [structuredClone(session)] : [];
      });
    },

    async searchSessions(eventId, { q, startsFrom, startsBefore, limit }) {
      // ASCII-only lowercasing, as SQLite's lower() does.
      const lower = (text: string) => text.replace(/[A-Z]/g, (c) => c.toLowerCase());
      const needle = q === undefined ? undefined : lower(q);
      return sessionsOf(eventId)
        .filter(
          (s) =>
            needle === undefined ||
            [s.code ?? "", s.title ?? "", s.speakers ? JSON.stringify(s.speakers) : ""].some((field) =>
              lower(field).includes(needle),
            ),
        )
        .filter((s) => startsFrom === undefined || (s.startsAt !== undefined && s.startsAt >= startsFrom))
        .filter((s) => startsBefore === undefined || (s.startsAt !== undefined && s.startsAt < startsBefore))
        .sort(bySessionOrder)
        .slice(0, limit)
        .map((s) => structuredClone(s));
    },

    async entry(attendeeId, eventId, sessionId) {
      const entry = plans.get(entryKey(attendeeId, eventId, sessionId));
      return entry && structuredClone(entry);
    },

    async entries(attendeeId, eventId) {
      return entriesOf(attendeeId, eventId).map((entry) => structuredClone(entry));
    },

    async schedule(attendeeId, eventId) {
      return entriesOf(attendeeId, eventId)
        .map((entry) => ({
          entry: structuredClone(entry),
          session: structuredClone(catalog.get(sessionKey(eventId, entry.sessionId))!),
        }))
        .sort((a, b) => bySessionOrder(a.session, b.session));
    },

    async applySync({ attendeeId, eventId, sessions, add, remove, update }) {
      for (const session of sessions) catalog.set(sessionKey(session.eventId, session.sessionId), structuredClone(session));
      for (const sessionId of remove) plans.delete(entryKey(attendeeId, eventId, sessionId));
      for (const { sessionId, intent } of update) {
        const entry = plans.get(entryKey(attendeeId, eventId, sessionId));
        if (entry) entry.intent = intent;
      }
      for (const entry of add) putEntry(eventId, entry);
    },

    async addEntry(eventId, entry) {
      if (!plans.has(entryKey(entry.attendeeId, eventId, entry.sessionId))) putEntry(eventId, entry);
    },

    async removeEntry(attendeeId, eventId, sessionId) {
      const key = entryKey(attendeeId, eventId, sessionId);
      plans.delete(key);
      eventOf.delete(key);
    },

    async setHidden(attendeeId, eventId, sessionId, hidden) {
      const entry = plans.get(entryKey(attendeeId, eventId, sessionId));
      if (entry) entry.hidden = hidden;
    },
  };
}

const compareText = (a: string | undefined, b: string | undefined) =>
  a === b ? 0 : a === undefined ? 1 : b === undefined ? -1 : a < b ? -1 : 1;

function bySessionOrder(a: CatalogSession, b: CatalogSession): number {
  return compareText(a.startsAt, b.startsAt) || compareText(a.code, b.code) || compareText(a.sessionId, b.sessionId);
}
