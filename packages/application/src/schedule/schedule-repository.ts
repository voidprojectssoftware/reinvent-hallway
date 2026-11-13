import type { PlanEntry, Session, SessionReport, SyncedSession } from "@hallway/domain";

/**
 * A session as the catalog serves it: the reporters' consensus, plus when an
 * agent last sent it. Never its abstract, which only `abstracts` reads, so no
 * read path can carry it by accident (ADR 0025).
 */
export interface CatalogSession extends Session {
  lastSeenAt: string;
}

/** One entry on a schedule, with its session. */
export interface ScheduledEntry {
  entry: PlanEntry;
  session: CatalogSession;
}

export interface SessionFilter {
  /** Matched against the code, title and speakers, both sides through the domain's `foldText` (case and accents ignored). */
  q?: string;
  /** Sessions starting at or after this instant (ISO, UTC). */
  startsFrom?: string;
  /** Sessions starting before this instant (ISO, UTC). */
  startsBefore?: string;
  /** Exact values: `type` and `level` equal, `topic`, `track` and `service` one of that list's items. */
  type?: string;
  level?: string;
  topic?: string;
  track?: string;
  service?: string;
  limit: number;
}

/** What the attendee's last sync for an event did, and when (domain.md, "Plan entry"). */
export interface LastSync {
  syncedAt: string;
  added: number;
  removed: number;
  changed: number;
  unchanged: number;
  /** How many listed ids were skipped for want of a session. */
  missingSessions: number;
}

/**
 * Everything one sync writes. Applied all or nothing, and from this alone,
 * never from rows read before it (ADR 0016): two syncs at once end as one of
 * them, never as their union.
 */
export interface SyncWrite {
  attendeeId: string;
  eventId: string;
  /**
   * The attendee's reports, already merged forward over their own previous
   * report. Each replaces that attendee's report of its session, and the
   * session's catalog row becomes the domain's `consensus` of all its reports.
   */
  reports: SessionReport[];
  /**
   * Everything the sync sent (`syncedSessions`). After the write the
   * attendee's `agent-sync` entries for the event are exactly these, new ones
   * added at `at`, and each `manual` entry is `manualAfterSync` of its session.
   */
  synced: SyncedSession[];
  at: string;
  /** Replaces the attendee's last sync for the event, in the same write, so it never tells of a sync that did not land. */
  lastSync: LastSync;
}

/**
 * Where the session catalog and plan entries are kept. One port for both,
 * because a sync writes both and must do it atomically. packages/infrastructure
 * implements it on D1 and in memory.
 *
 * Ordering, for every list of sessions: by start (unplaced last), then code,
 * then id.
 */
export interface ScheduleRepository {
  session(eventId: string, sessionId: string): Promise<CatalogSession | undefined>;
  /** The ones of these ids the catalog has, in any order. */
  sessions(eventId: string, sessionIds: readonly string[]): Promise<CatalogSession[]>;
  /** The first `limit` matching sessions in session order, and how many match in all. */
  searchSessions(eventId: string, filter: SessionFilter): Promise<{ sessions: CatalogSession[]; total: number }>;
  /** The attendee's own reports of these sessions, those there are, in any order. */
  reports(attendeeId: string, eventId: string, sessionIds: readonly string[]): Promise<SessionReport[]>;
  /**
   * The domain's `isCorroborated` over the event's reports: whether some
   * report of the attendee's carries an abstract another attendee's report of
   * the same session also carries. One read, whatever the reader reported.
   */
  hasCorroboratedAbstract(attendeeId: string, eventId: string): Promise<boolean>;
  /**
   * The catalog's abstract of each of these sessions that has one, by id. The
   * one read of the abstract: callers ask `canReadAbstract` first (ADR 0025).
   */
  abstracts(eventId: string, sessionIds: readonly string[]): Promise<Map<string, string>>;

  entry(attendeeId: string, eventId: string, sessionId: string): Promise<PlanEntry | undefined>;
  entries(attendeeId: string, eventId: string): Promise<PlanEntry[]>;
  /** The attendee's entries with their sessions, hidden ones included, in session order. */
  schedule(attendeeId: string, eventId: string): Promise<ScheduledEntry[]>;

  /** What the attendee's last sync for the event did; undefined before the first. */
  lastSync(attendeeId: string, eventId: string): Promise<LastSync | undefined>;

  /** One atomic write: either all of it lands or none of it does. */
  applySync(write: SyncWrite): Promise<void>;
  /** Adds the entry unless the attendee already has one for the session, which is then kept as it is. */
  addEntry(eventId: string, entry: PlanEntry): Promise<void>;
  removeEntry(attendeeId: string, eventId: string, sessionId: string): Promise<void>;
  /**
   * Puts the session in, or takes it out of, the attendee's hidden set for
   * the event. Entries are not touched: an entry is hidden while its session
   * is in the set, whenever it is on the schedule.
   */
  setHidden(attendeeId: string, eventId: string, sessionId: string, hidden: boolean): Promise<void>;
}
