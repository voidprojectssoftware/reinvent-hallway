// What the network handlers need from storage. packages/infrastructure
// implements it on D1 and in memory; apps/api picks one in its composition root.
import type { Connection, ConnectionRequest, ImportedContact, PlanEntry, RequestStatus } from "@hallway/domain";
import type { AttendeeRecord } from "../identity/ports.ts";
import type { CatalogSession } from "../schedule/schedule-repository.ts";

/** A request as stored: the domain's request with the id the interfaces address it by. */
export interface ConnectionRequestRecord extends ConnectionRequest {
  id: string;
}

export interface ContactImportRecord {
  id: string;
  attendeeId: string;
  importedAt: string;
  count: number;
}

/** One of a connection's plan entries, with its session and its owner. */
export interface ConnectionPlan {
  owner: AttendeeRecord;
  entry: PlanEntry;
  session: CatalogSession;
}

/** Which of my connections' entries to read: for these sessions, or for sessions starting in a window. */
export type PlanScope =
  | { sessionIds: readonly string[] }
  | { startsFrom: string; startsBefore: string };

export interface NetworkRepository {
  areConnected(one: string, other: string): Promise<boolean>;
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
   * The attendees one of my contacts could point at (by verified email hash,
   * or by claimed profile URL), and those contacts. A narrowing only: the
   * domain's `suggestions` decides who is suggested.
   */
  contactMatches(attendeeId: string): Promise<{ contacts: ImportedContact[]; candidates: AttendeeRecord[] }>;
  /** Everyone I am connected to or have a pending request with, either direction. */
  linkedTo(attendeeId: string): Promise<Set<string>>;

  /**
   * My connections' entries for an event in one read, hidden ones included:
   * the handler filters them through the domain's `visibleEntries`, which is
   * what keeps the rule in one place.
   */
  connectionPlans(viewerId: string, eventId: string, scope: PlanScope): Promise<ConnectionPlan[]>;
}
