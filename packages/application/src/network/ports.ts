// What the network handlers need from storage. packages/infrastructure
// implements it on D1 and in memory; apps/api picks one in its composition root.
import type {
  Connection,
  ConnectionRequest,
  FollowSource,
  ImportedContact,
  PlanEntry,
  RequestStatus,
  SuggestionCandidate,
  Tie,
} from "@hallway/domain";
import type { AttendeeRecord } from "../identity/ports.ts";
import type { CatalogSession } from "../schedule/schedule-repository.ts";

/** A request as stored: the domain's request with the id the interfaces address it by. */
export interface ConnectionRequestRecord extends ConnectionRequest {
  id: string;
}

/** Kept readable so its owner can copy the link again, like the calendar feed (ADR 0008). */
export interface InviteRecord {
  token: string;
  rotatedAt: string;
}

export interface ContactImportRecord {
  id: string;
  attendeeId: string;
  importedAt: string;
  count: number;
}

/** One plan entry of someone in my network, with its session, its owner, and how I stand to them. */
export interface NetworkPlan {
  owner: AttendeeRecord;
  /** How the viewer stands to the owner: what the visibility rule needs. */
  tie: Tie;
  entry: PlanEntry;
  session: CatalogSession;
}

/**
 * Someone in my network (ADR 0019): a connection, someone I follow, or both.
 * People who follow me without my following them are not in it, although
 * they may let me see their schedule.
 */
export interface NetworkMemberRecord {
  other: AttendeeRecord;
  connection?: Connection;
  /** Each source I follow them from, with when that follow was first stored. */
  follows: { source: FollowSource; since: string }[];
  tie: Tie;
}

/** Which of my network's entries to read: for these sessions, for sessions starting in a window, or all at the event. */
export type PlanScope =
  | { sessionIds: readonly string[] }
  | { startsFrom: string; startsBefore: string }
  | { wholeEvent: true };

export interface NetworkRepository {
  areConnected(one: string, other: string): Promise<boolean>;
  /** How `viewer` stands to `owner`, in one read: connected, and whether the owner follows the viewer. */
  tie(viewer: string, owner: string): Promise<Tie>;
  /** The pair's connection, either spelling of the pair. */
  connection(one: string, other: string): Promise<Connection | undefined>;
  /** My connections with the attendee at the other end. */
  connectionsOf(attendeeId: string): Promise<{ connection: Connection; other: AttendeeRecord }[]>;
  /**
   * One atomic write: the connection (kept if the pair already has one) and
   * every pending request between the two, either direction, marked accepted.
   * Two requests that crossed become one connection.
   */
  connect(connection: Connection, at: string): Promise<void>;
  removeConnection(one: string, other: string): Promise<void>;

  /** The attendee's current invite token (their share link's secret), if they have one. */
  invite(attendeeId: string): Promise<InviteRecord | undefined>;
  /** The current invite, storing this one first if there is none: two first reads agree. */
  ensureInvite(attendeeId: string, token: string, at: string): Promise<InviteRecord>;
  /** Replaces the invite; links with the old token stop connecting. */
  replaceInvite(attendeeId: string, token: string, at: string): Promise<void>;

  request(id: string): Promise<ConnectionRequestRecord | undefined>;
  /** The pending request from `from` to `to`, if there is one. */
  pendingRequest(from: string, to: string): Promise<ConnectionRequestRecord | undefined>;
  /** Pending requests to or from me, newest first, each with the attendee at the other end. */
  pendingRequestsOf(attendeeId: string): Promise<{ request: ConnectionRequestRecord; other: AttendeeRecord }[]>;
  createRequest(request: ConnectionRequestRecord): Promise<void>;
  /** Decline or withdraw: only a pending request changes. */
  closeRequest(id: string, status: Exclude<RequestStatus, "pending" | "accepted">, at: string): Promise<void>;

  /** Replaces the attendee's import and its contacts, all or nothing. */
  replaceContacts(contactImport: ContactImportRecord, contacts: readonly ImportedContact[]): Promise<void>;
  contactImport(attendeeId: string): Promise<ContactImportRecord | undefined>;
  /**
   * The attendees one of my contacts could point at (by a verified identity email hash,
   * or by claimed profile URL), each with its matching hashes, and those contacts. A narrowing only: the
   * domain's `suggestions` decides who is suggested.
   */
  contactMatches(attendeeId: string): Promise<{ contacts: ImportedContact[]; candidates: SuggestionCandidate[] }>;
  /** Everyone I am connected to or have a pending request with, either direction. */
  linkedTo(attendeeId: string): Promise<Set<string>>;

  /**
   * Replaces the attendee's GitHub follows with these GitHub user ids, in one
   * batch however many (ADR 0011). A follow kept keeps its `since`. An id
   * names a GitHub account, so it points at whoever links that account,
   * now or later.
   */
  replaceGitHubFollows(attendeeId: string, gitHubIds: readonly string[], at: string): Promise<void>;
  /** Replaces the attendee's `linkedin-import` follows with these attendees. A follow kept keeps its `since`. */
  replaceImportFollows(attendeeId: string, followeeIds: readonly string[], at: string): Promise<void>;
  /** My connections and the attendees I follow, each once, with how. Never me. */
  networkOf(attendeeId: string): Promise<NetworkMemberRecord[]>;
  /** How many GitHub accounts I follow that no attendee has linked yet. */
  gitHubFollowsNotOnHallway(attendeeId: string): Promise<number>;

  /**
   * The entries of everyone in my network (`networkOf`) for an event in one
   * read, hidden ones included, each with how I stand to its owner: the
   * handler filters them through the domain's `visibleEntries`, which is
   * what keeps the rule in one place.
   */
  networkPlans(viewerId: string, eventId: string, scope: PlanScope): Promise<NetworkPlan[]>;
}
