// What the identity handlers need from the outside world. packages/infrastructure
// implements the repositories on D1 and in memory, and an identity provider
// for each of Google, Microsoft, LinkedIn and GitHub; apps/api picks them in
// its composition root.
import type { SignInProvider } from "@hallway/contracts";
import type { Attendee } from "@hallway/domain";

/** An attendee as stored: the domain's Attendee plus what only auditing reads. */
export interface AttendeeRecord extends Attendee {
  createdAt: string;
}

/** A way in that is stored: the four providers, and dev sign-in by name on a dev server. */
export type IdentityKind = SignInProvider | "dev";

/**
 * One provider account an attendee signs in with (ADR 0018). Part of the
 * attendee: created with it, and never without one.
 */
export interface IdentityRecord {
  attendeeId: string;
  provider: IdentityKind;
  /** The provider's stable user id: OIDC `sub`, GitHub's numeric id. Never a login or an email. */
  subject: string;
  email?: string;
  emailVerified: boolean;
  /** `hashEmail(email)`, only when the email is verified: what suggestions and the email-exists rule match on. */
  verifiedEmailSha256?: string;
  /** The GitHub login. */
  username?: string;
  linkedAt: string;
}

/** The attendee and the identities they sign in with, one aggregate (domain.md). */
export interface AttendeeRepository {
  byId(id: string): Promise<AttendeeRecord | undefined>;
  byHandle(handle: string): Promise<AttendeeRecord | undefined>;
  /** The identity with this provider and subject, whoever it belongs to. */
  identity(provider: IdentityKind, subject: string): Promise<IdentityRecord | undefined>;
  /** The attendee's identities, oldest first: the first is the one their verified name came from. */
  identitiesOf(attendeeId: string): Promise<IdentityRecord[]>;
  /** Some identity, any attendee's, whose verified email hashes to this. */
  identityWithVerifiedEmail(emailSha256: string): Promise<IdentityRecord | undefined>;
  /** A new attendee and the identity they first signed in with, together or not at all. */
  create(attendee: AttendeeRecord, firstIdentity: IdentityRecord): Promise<void>;
  /** Replaces the stored attendee with this one, matched by id. */
  save(attendee: AttendeeRecord): Promise<void>;
  /** Adds an identity to an existing attendee. Fails on a taken (provider, subject) or a second of one provider. */
  link(identity: IdentityRecord): Promise<void>;
  /** Replaces what the provider last said (email, username), matched by provider and subject. */
  saveIdentity(identity: IdentityRecord): Promise<void>;
  unlink(attendeeId: string, provider: IdentityKind): Promise<void>;
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

/** A GitHub account, by its stable id; the login is only for showing. */
export interface GitHubUser {
  id: string;
  login: string;
}

/** Who the identity provider says signed in. */
export interface VerifiedIdentity {
  /** The provider's stable subject id: OIDC `sub`, GitHub's numeric id. */
  subject: string;
  name: string;
  picture?: string;
  email?: string;
  /** Only what the provider vouches for; the adapter decides (Microsoft: ADR 0018). */
  emailVerified: boolean;
  /** GitHub's login. */
  username?: string;
  /**
   * Who this person follows on GitHub, read with their token during the
   * round trip, after which the token is dropped (ADR 0019). GitHub only.
   */
  following?: GitHubUser[];
}

/**
 * One sign-in provider behind one port (ADR 0018): an authorization code
 * flow for a confidential client. Each adapter is tested against a fake of
 * its provider.
 */
export interface IdentityProvider {
  authorizationUrl(input: { state: string; redirectUri: string }): string;
  /** Redeems the authorization code. Undefined when the provider refuses it. */
  identify(input: { code: string; redirectUri: string }): Promise<VerifiedIdentity | undefined>;
}

/** The providers configured here; a provider with no client id is absent. */
export type IdentityProviders = Partial<Record<SignInProvider, IdentityProvider>>;

/**
 * Where the people an attendee follows on GitHub go once fetched (ADR 0019).
 * #63 stores them as follows; until then it is a no-op.
 */
export type RecordGitHubFollowing = (input: { attendeeId: string; following: GitHubUser[] }) => Promise<void>;
