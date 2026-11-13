// What the identity handlers need from the outside world. packages/infrastructure
// implements the repositories on D1 and in memory, and the identity provider
// for LinkedIn; apps/api picks them in its composition root.
import type { Attendee } from "@hallway/domain";

/** An attendee as stored: the domain's Attendee plus what only matching and auditing read. */
export interface AttendeeRecord extends Attendee {
  /** `hashEmail(email)`, kept beside the email so suggestions can look it up. */
  verifiedEmailSha256?: string;
  createdAt: string;
}

export interface AttendeeRepository {
  byId(id: string): Promise<AttendeeRecord | undefined>;
  byHandle(handle: string): Promise<AttendeeRecord | undefined>;
  byLinkedinSub(sub: string): Promise<AttendeeRecord | undefined>;
  create(attendee: AttendeeRecord): Promise<void>;
  /** Replaces the stored attendee with this one, matched by id. */
  save(attendee: AttendeeRecord): Promise<void>;
}

export interface AgentTokenRecord {
  id: string;
  attendeeId: string;
  label: string;
  prefix: string;
  /** SHA-256 hex of the whole secret. The secret itself is never stored. */
  secretSha256: string;
  createdAt: string;
  lastUsedAt?: string;
  revokedAt?: string;
}

export interface AgentTokenRepository {
  create(token: AgentTokenRecord): Promise<void>;
  byId(id: string): Promise<AgentTokenRecord | undefined>;
  /** Found by the hash of the whole secret, never by its prefix. */
  bySecretSha256(secretSha256: string): Promise<AgentTokenRecord | undefined>;
  /** The attendee's tokens, oldest first, revoked ones included. */
  listFor(attendeeId: string): Promise<AgentTokenRecord[]>;
  touch(id: string, at: string): Promise<void>;
  revoke(id: string, at: string): Promise<void>;
}

export interface WebSessionRecord {
  /** SHA-256 hex of the cookie's value. */
  idSha256: string;
  attendeeId: string;
  createdAt: string;
  expiresAt: string;
}

export interface WebSessionRepository {
  create(session: WebSessionRecord): Promise<void>;
  byIdSha256(idSha256: string): Promise<WebSessionRecord | undefined>;
  delete(idSha256: string): Promise<void>;
}

/** The token is kept readable so its owner can see the link again (ADR 0008). */
export interface CalendarFeedRepository {
  /** Sets the attendee's one feed token, replacing any earlier one. */
  replace(attendeeId: string, token: string, rotatedAt: string): Promise<void>;
  get(attendeeId: string): Promise<{ token: string; rotatedAt: string } | undefined>;
  /** Whose feed this token opens; undefined once it has been rotated away. */
  ownerOf(token: string): Promise<string | undefined>;
}

/** Whether two attendees are connected. The network slice owns the real answer. */
export type AreConnected = (a: string, b: string) => Promise<boolean>;

/** Who the identity provider says signed in. */
export interface VerifiedIdentity {
  /** The provider's stable subject id (LinkedIn's `sub`). */
  subject: string;
  name: string;
  picture?: string;
  email?: string;
  emailVerified: boolean;
}

/** An OpenID Connect provider (LinkedIn), behind a port so tests use a fake. */
export interface IdentityProvider {
  authorizationUrl(input: { state: string; redirectUri: string }): string;
  /** Redeems the authorization code. Undefined when the provider refuses it. */
  identify(input: { code: string; redirectUri: string }): Promise<VerifiedIdentity | undefined>;
}
