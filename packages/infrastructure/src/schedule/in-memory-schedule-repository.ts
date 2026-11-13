import type { CatalogSession, LastSync, ScheduleRepository } from "@hallway/application";
import {
  consensus,
  foldSpeakers,
  foldText,
  planSync,
  withoutAbstract,
  type PlanEntry,
  type SessionReport,
} from "@hallway/domain";

/** The fake: answers as the D1 repository does (schedule-repository.test.ts holds both to it). */
export function scheduleInMemory(): ScheduleRepository {
  const catalog = new Map<string, CatalogSession>();
  /** Kept beside the catalog, as only `abstracts` reads it (ADR 0025, issue #103). */
  const abstractOf = new Map<string, string>();
  const reportsBySession = new Map<string, Map<string, SessionReport>>();
  /** Entries without their hidden state, which lives in `hidden`. */
  const plans = new Map<string, Omit<PlanEntry, "hidden">>();
  const hidden = new Set<string>();
  const sessionKey = (eventId: string, sessionId: string) => JSON.stringify([eventId, sessionId]);
  const entryKey = (attendeeId: string, eventId: string, sessionId: string) =>
    JSON.stringify([attendeeId, eventId, sessionId]);
  const eventOf = new Map<string, string>();
  const lastSyncs = new Map<string, LastSync>();

  const sessionsOf = (eventId: string) => [...catalog.values()].filter((s) => s.eventId === eventId);
  const withHidden = (eventId: string, entry: Omit<PlanEntry, "hidden">): PlanEntry => ({
    ...structuredClone(entry),
    hidden: hidden.has(entryKey(entry.attendeeId, eventId, entry.sessionId)),
  });
  const entriesOf = (attendeeId: string, eventId: string) =>
    [...plans.entries()]
      .filter(([key, entry]) => entry.attendeeId === attendeeId && eventOf.get(key) === eventId)
      .map(([, entry]) => withHidden(eventId, entry));
  const putEntry = (eventId: string, { hidden: _hidden, ...entry }: PlanEntry) => {
    const key = entryKey(entry.attendeeId, eventId, entry.sessionId);
    plans.set(key, structuredClone(entry));
    eventOf.set(key, eventId);
  };
  // The same fold the D1 repository stores, applied here at query time.
  const searchText = (s: CatalogSession) => [
    foldText(s.code ?? ""),
    foldText(s.title ?? ""),
    s.speakers ? foldSpeakers(s.speakers) : "",
  ];

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

    async searchSessions(eventId, { q, startsFrom, startsBefore, type, level, topic, track, service, limit }) {
      const needle = q === undefined ? undefined : foldText(q);
      const has = (list: string[] | undefined, value: string | undefined) => value === undefined || !!list?.includes(value);
      const matching = sessionsOf(eventId)
        .filter((s) => needle === undefined || searchText(s).some((field) => field.includes(needle)))
        .filter((s) => (type === undefined || s.type === type) && (level === undefined || s.level === level))
        .filter((s) => has(s.topics, topic) && has(s.tracks, track) && has(s.services, service))
        .filter((s) => startsFrom === undefined || (s.startsAt !== undefined && s.startsAt >= startsFrom))
        .filter((s) => startsBefore === undefined || (s.startsAt !== undefined && s.startsAt < startsBefore))
        .sort(bySessionOrder);
      return { sessions: matching.slice(0, limit).map((s) => structuredClone(s)), total: matching.length };
    },

    async reports(attendeeId, eventId, sessionIds) {
      return [...new Set(sessionIds)].flatMap((id) => {
        const report = reportsBySession.get(sessionKey(eventId, id))?.get(attendeeId);
        return report ? [structuredClone(report)] : [];
      });
    },

    async abstracts(eventId, sessionIds) {
      return new Map(
        [...new Set(sessionIds)].flatMap((id) => {
          const abstract = abstractOf.get(sessionKey(eventId, id));
          return abstract === undefined ? [] : [[id, abstract] as const];
        }),
      );
    },

    async entry(attendeeId, eventId, sessionId) {
      const entry = plans.get(entryKey(attendeeId, eventId, sessionId));
      return entry && withHidden(eventId, entry);
    },

    async entries(attendeeId, eventId) {
      return entriesOf(attendeeId, eventId);
    },

    async schedule(attendeeId, eventId) {
      return entriesOf(attendeeId, eventId)
        .map((entry) => ({
          entry,
          session: structuredClone(catalog.get(sessionKey(eventId, entry.sessionId))!),
        }))
        .sort((a, b) => bySessionOrder(a.session, b.session));
    },

    async lastSync(attendeeId, eventId) {
      const lastSync = lastSyncs.get(JSON.stringify([attendeeId, eventId]));
      return lastSync && structuredClone(lastSync);
    },

    async applySync({ attendeeId, eventId, reports, synced, at, lastSync }) {
      for (const report of reports) {
        const key = sessionKey(report.eventId, report.sessionId);
        const all = reportsBySession.get(key) ?? new Map<string, SessionReport>();
        all.set(report.attendeeId, structuredClone(report));
        reportsBySession.set(key, all);
        const every = [...all.values()];
        const agreed = consensus(every);
        catalog.set(key, {
          ...withoutAbstract(agreed),
          lastSeenAt: every.map((r) => r.reportedAt).reduce((a, b) => (a > b ? a : b)),
        });
        if (agreed.abstract === undefined) abstractOf.delete(key);
        else abstractOf.set(key, agreed.abstract);
      }
      // Planned against the entries as they are now, which in memory is the
      // same as computing it inside the write.
      const plan = planSync(entriesOf(attendeeId, eventId), synced);
      for (const { sessionId } of plan.remove) plans.delete(entryKey(attendeeId, eventId, sessionId));
      for (const { sessionId, intent, invited } of plan.update) {
        Object.assign(plans.get(entryKey(attendeeId, eventId, sessionId))!, { intent, invited });
      }
      for (const { sessionId, intent, invited } of plan.add) {
        putEntry(eventId, { attendeeId, sessionId, intent, invited, source: "agent-sync", hidden: false, addedAt: at });
      }
      lastSyncs.set(JSON.stringify([attendeeId, eventId]), structuredClone(lastSync));
    },

    async addEntry(eventId, entry) {
      if (!plans.has(entryKey(entry.attendeeId, eventId, entry.sessionId))) putEntry(eventId, entry);
    },

    async removeEntry(attendeeId, eventId, sessionId) {
      const key = entryKey(attendeeId, eventId, sessionId);
      plans.delete(key);
      eventOf.delete(key);
    },

    async setHidden(attendeeId, eventId, sessionId, hide) {
      const key = entryKey(attendeeId, eventId, sessionId);
      if (hide) hidden.add(key);
      else hidden.delete(key);
    },
  };
}

const compareText = (a: string | undefined, b: string | undefined) =>
  a === b ? 0 : a === undefined ? 1 : b === undefined ? -1 : a < b ? -1 : 1;

function bySessionOrder(a: CatalogSession, b: CatalogSession): number {
  return compareText(a.startsAt, b.startsAt) || compareText(a.code, b.code) || compareText(a.sessionId, b.sessionId);
}
