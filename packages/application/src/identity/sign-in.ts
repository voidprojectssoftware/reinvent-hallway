// SignIn (domain.md): a verified identity in, a web session out. LinkedIn and
// dev sign-in both end here, so an attendee is created, and refreshed, in one
// place whichever door was used.
import type { DevSignInInput, Me } from "@hallway/contracts";
import { handleFromName, hashEmail, normalizeName } from "@hallway/domain";
import { fail, ok, type Outcome } from "../outcome.ts";
import type {
  AttendeeRecord,
  AttendeeRepository,
  IdentityProvider,
  VerifiedIdentity,
  WebSessionRepository,
} from "./ports.ts";
import { randomSecret, sha256Hex } from "./secrets.ts";
import { toMe } from "./views.ts";

export const sessionLifetimeDays = 30;

/** What sign-in hands back to the interface: the attendee and the cookie's secret. */
export interface SignedIn {
  me: Me;
  session: { secret: string; expiresAt: string };
}

export type SignIn = (identity: VerifiedIdentity) => Promise<Outcome<SignedIn>>;
export type DevSignIn = (input: DevSignInInput) => Promise<Outcome<SignedIn>>;
export type BeginLinkedInSignIn = (input: { redirectUri: string }) => Promise<
  Outcome<{ authorizationUrl: string; state: string }>
>;
export type CompleteLinkedInSignIn = (input: {
  code?: string | undefined;
  state?: string | undefined;
  /** The state the browser's short-lived cookie holds; absent when it has none. */
  expectedState?: string | undefined;
  error?: string | undefined;
  redirectUri: string;
}) => Promise<Outcome<SignedIn>>;
export type SignOut = (input: { sessionSecret: string }) => Promise<Outcome<Record<string, never>>>;

export function signIn(
  attendees: AttendeeRepository,
  sessions: WebSessionRepository,
  now: () => Date,
): SignIn {
  return async (identity) => {
    const known = await attendees.byLinkedinSub(identity.subject);
    const attendee = known
      ? await refreshed(known, identity)
      : await created(identity, await freeHandle(attendees, identity.name), now());
    if (known) await attendees.save(attendee);
    else await attendees.create(attendee);

    const secret = randomSecret();
    const createdAt = now();
    const expiresAt = new Date(createdAt.getTime() + sessionLifetimeDays * 86_400_000).toISOString();
    await sessions.create({
      idSha256: await sha256Hex(secret),
      attendeeId: attendee.id,
      createdAt: createdAt.toISOString(),
      expiresAt,
    });
    return ok({ me: toMe(attendee), session: { secret, expiresAt } });
  };
}

/**
 * Dev sign-in: believes the name it is given. The interface offers it only
 * when DEV_SIGN_IN is on (ADR 0004). The same name signs in as the same
 * attendee, so a dev can come back to their data.
 */
export function devSignIn(signInWith: SignIn): DevSignIn {
  return ({ name }) =>
    signInWith({ subject: `dev:${normalizeName(name)}`, name, emailVerified: false });
}

export function beginLinkedInSignIn(provider: IdentityProvider | undefined): BeginLinkedInSignIn {
  return async ({ redirectUri }) => {
    if (!provider) return notConfigured();
    const state = randomSecret();
    return ok({ authorizationUrl: provider.authorizationUrl({ state, redirectUri }), state });
  };
}

/**
 * The OAuth callback. `state` must equal the one this browser was given at
 * the start (held in a short-lived cookie), which is what makes a callback
 * started in someone else's browser useless here.
 */
export function completeLinkedInSignIn(
  provider: IdentityProvider | undefined,
  signInWith: SignIn,
): CompleteLinkedInSignIn {
  return async ({ code, state, expectedState, error, redirectUri }) => {
    if (!provider) return notConfigured();
    if (!expectedState || state !== expectedState) {
      return fail("forbidden", "This sign-in was not started in this browser, or took too long. Start again.");
    }
    if (error) return fail("unauthenticated", `LinkedIn did not sign you in (${error}).`);
    if (!code) return fail("invalid", "The callback carries no authorization code.");
    const identity = await provider.identify({ code, redirectUri });
    if (!identity) return fail("unauthenticated", "LinkedIn did not accept the authorization code.");
    return signInWith(identity);
  };
}

export function signOut(sessions: WebSessionRepository): SignOut {
  return async ({ sessionSecret }) => {
    await sessions.delete(await sha256Hex(sessionSecret));
    return ok({});
  };
}

const notConfigured = () =>
  fail("not-found", "LinkedIn sign-in is not configured here (no LINKEDIN_CLIENT_ID).");

async function freeHandle(attendees: AttendeeRepository, name: string): Promise<string> {
  const taken = new Set<string>();
  for (;;) {
    const handle = handleFromName(name, taken);
    if (!(await attendees.byHandle(handle))) return handle;
    taken.add(handle);
  }
}

/** LinkedIn's verified facts. The email is kept only when LinkedIn says it is verified. */
async function verifiedFacts(identity: VerifiedIdentity) {
  const email = identity.emailVerified ? identity.email : undefined;
  return {
    verifiedName: identity.name,
    ...(email ? { email, verifiedEmailSha256: await hashEmail(email) } : {}),
  };
}

async function created(identity: VerifiedIdentity, handle: string, at: Date): Promise<AttendeeRecord> {
  return {
    id: crypto.randomUUID(),
    handle,
    displayName: identity.name,
    ...(identity.picture ? { avatarUrl: identity.picture } : {}),
    visibility: "connections",
    linkedinSub: identity.subject,
    ...(await verifiedFacts(identity)),
    createdAt: at.toISOString(),
  };
}

/** A returning attendee: LinkedIn's facts are refreshed, what they typed is kept. */
async function refreshed(known: AttendeeRecord, identity: VerifiedIdentity): Promise<AttendeeRecord> {
  const { email: _email, verifiedEmailSha256: _hash, verifiedName: _name, ...kept } = known;
  return {
    ...kept,
    ...(identity.picture ? { avatarUrl: identity.picture } : {}),
    ...(await verifiedFacts(identity)),
  };
}
