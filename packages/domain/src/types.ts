// The resources of docs/architecture/domain.md as the rules see them. Instants
// are ISO 8601 UTC strings ("2026-12-01T16:00:00.000Z"); ids are opaque strings.

export type Visibility = "public" | "connections" | "private";

export interface Attendee {
  id: string;
  handle: string;
  displayName: string;
  headline?: string;
  avatarUrl?: string;
  /** Typed by the attendee. Unverified: anyone can claim any URL. */
  linkedinProfileUrl?: string;
  visibility: Visibility;
  // Private fields, from Sign In with LinkedIn.
  linkedinSub: string;
  /** The name LinkedIn verified at sign-in. Unlike displayName, not editable. */
  verifiedName?: string;
  /** Present only when LinkedIn reported it verified. */
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
 * A catalog snapshot of one session. Every field but the two ids may be
 * absent, as in AWS's own shape. There is no abstract, by design (ADR 0003),
 * and no url: it is derived from `code` by `sessionUrl`.
 */
export interface Session {
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
  topics?: string[];
}

export type Intent = "interested" | "reserved";
export type EntrySource = "agent-sync" | "manual";

export interface PlanEntry {
  attendeeId: string;
  sessionId: string;
  intent: Intent;
  source: EntrySource;
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

/** One row of a LinkedIn Connections.csv, reduced to what matching needs. */
export interface ImportedContact {
  /** `linkedin.com/in/<lowercase-slug>` */
  profileUrl?: string;
  /** Normalized by `normalizeName`. Empty when the row had no name. */
  name: string;
  /** SHA-256 hex of the trimmed, lowercased email. */
  emailSha256?: string;
}
