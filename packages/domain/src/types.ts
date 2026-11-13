// The resources of docs/architecture/domain.md as the rules see them. Instants
// are ISO 8601 UTC strings ("2026-12-01T16:00:00.000Z"); ids are opaque strings.

/**
 * Who may see an attendee's schedule. `network` was `connections` until #63:
 * the attendee, their connections and the people they follow (ADR 0019).
 */
export type Visibility = "public" | "network" | "private";

export interface Attendee {
  id: string;
  handle: string;
  /**
   * The handle is the "attendee-" one Hallway made because the name had no
   * Latin letter to make one from. Cleared when the attendee chooses one.
   */
  handlePlaceholder: boolean;
  displayName: string;
  headline?: string;
  avatarUrl?: string;
  /** Typed by the attendee. Unverified: anyone can claim any URL. */
  linkedinProfileUrl?: string;
  visibility: Visibility;
  // Private fields, from the first identity the attendee signed in with (ADR 0018).
  /** The name that provider gave. Unlike displayName, not editable. */
  verifiedName?: string;
  /** Present only when that provider reported it verified. */
  email?: string;
}

export interface Event {
  eventId: string;
  name: string;
  /** IANA zone, e.g. "America/Los_Angeles". Every session time is local to it. */
  timezone: string;
  startDate: string;
  endDate: string;
}

/**
 * The descriptive lists AWS tags a session with, kept as AWS sends them
 * (ADR 0025). Each is one value to the catalog's consensus: a list is voted
 * on whole, never item by item. `sessionTags` in sessions.ts lists them.
 */
export type SessionTag =
  | "topics"
  | "tracks"
  | "services"
  | "roles"
  | "industries"
  | "areasOfInterest"
  | "segments"
  | "features"
  | "customerPersonas"
  | "experiences"
  | "additionalActivities"
  | "focusAreas";

/**
 * One session as anyone who may see it sees it. Every field but the two ids
 * may be absent, as in AWS's own shape. No url: it is derived from `code` by
 * `sessionUrl`. No abstract: that is a `SessionSnapshot`'s, and leaves the
 * catalog only to a reader `canReadAbstract` allows (ADR 0025).
 */
export interface Session extends Partial<Record<SessionTag, string[]>> {
  sessionId: string;
  eventId: string;
  code?: string;
  title?: string;
  type?: string;
  level?: string;
  venue?: string;
  room?: string;
  /** Absent when AWS gave no usable date and time: the session cannot be placed in a day. */
  startsAt?: string;
  endsAt?: string;
  isAllDay?: boolean;
  speakers?: string[];
}

/**
 * Everything Hallway keeps of a session an agent sent: the session, and its
 * abstract, AWS's plain-text description. Reports are snapshots and the
 * catalog stores one; what the catalog serves is a `Session`.
 */
export interface SessionSnapshot extends Session {
  abstract?: string;
}

export type Intent = "interested" | "reserved";
export type EntrySource = "agent-sync" | "manual";

export interface PlanEntry {
  attendeeId: string;
  sessionId: string;
  /** For a `manual` entry, `reserved` while the latest sync reports it reserved, else the attendee's own. */
  intent: Intent;
  source: EntrySource;
  /** The latest sync had it from AWS `invitedSessions`: the event placed it on the schedule. */
  invited: boolean;
  /**
   * The attendee hid the session. A preference kept apart from the entry, per
   * attendee and event, so it outlives the entry leaving and coming back.
   */
  hidden: boolean;
  addedAt: string;
}

export type ConnectionVia = "request" | "share-link";

/** Unordered pair, stored with `a < b` so one pair has one spelling. */
export interface Connection {
  a: string;
  b: string;
  since: string;
  via: ConnectionVia;
}

export type RequestStatus = "pending" | "accepted" | "declined" | "withdrawn";

export interface ConnectionRequest {
  from: string;
  to: string;
  status: RequestStatus;
  createdAt: string;
}

export type FollowSource = "github" | "linkedin-import";

/** One row of a LinkedIn Connections.csv, reduced to what matching needs. */
export interface ImportedContact {
  /** `linkedin.com/in/<lowercase-slug>` */
  profileUrl?: string;
  /** Normalized by `normalizeName`. Empty when the row had no name. */
  name: string;
  /** SHA-256 hex of the trimmed, lowercased email. */
  emailSha256?: string;
}
