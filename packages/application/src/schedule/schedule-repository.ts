import type { PlanEntry, Session } from "@hallway/domain";

/** A session as the catalog keeps it: the domain's snapshot, plus when an agent last sent it. */
export interface CatalogSession extends Session {
  lastSeenAt: string;
}

/** One entry on a schedule, with its session. */
export interface ScheduledEntry {
  entry: PlanEntry;
  session: CatalogSession;
}

export interface SessionFilter {
  /** Matched, ignoring ASCII case, against the code, title and speakers. */
  q?: string;
  /** Sessions starting at or after this instant (ISO, UTC). */
  startsFrom?: string;
  /** Sessions starting before this instant (ISO, UTC). */
  startsBefore?: string;
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

/** Everything one sync writes. Applied all or nothing. */
export interface SyncWrite {
  attendeeId: string;
  eventId: string;
  /** Whole session rows, already merged forward: each replaces its stored row. */
  sessions: CatalogSession[];
  add: PlanEntry[];
  /** Session ids whose entries go. */
  remove: string[];
  /** Entries whose intent changed; only `intent` is written. */
  update: PlanEntry[];
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
  searchSessions(eventId: string, filter: SessionFilter): Promise<CatalogSession[]>;

  entry(attendeeId: string, eventId: string, sessionId: string): Promise<PlanEntry | undefined>;
  entries(attendeeId: string, eventId: string): Promise<PlanEntry[]>;
  /** The attendee's entries with their sessions, hidden ones included, in session order. */
  schedule(attendeeId: string, eventId: string): Promise<ScheduledEntry[]>;

  /** What the attendee's last sync for the event did; undefined before the first. */
  lastSync(attendeeId: string, eventId: string): Promise<LastSync | undefined>;

  /** One atomic write: either all of it lands or none of it does. */
  applySync(write: SyncWrite): Promise<void>;
  addEntry(eventId: string, entry: PlanEntry): Promise<void>;
  removeEntry(attendeeId: string, eventId: string, sessionId: string): Promise<void>;
  setHidden(attendeeId: string, eventId: string, sessionId: string, hidden: boolean): Promise<void>;
}
