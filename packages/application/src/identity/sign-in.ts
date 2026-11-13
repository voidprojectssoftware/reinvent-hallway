// SignIn and LinkIdentity (domain.md, ADR 0018): a verified identity in, a web
// session (or a linked identity) out. Every provider and dev sign-in end here,
// so an attendee is created, refreshed and refused in one place whichever door
// was used.
import type { DevLinkGitHubInput, DevSignInInput, Identity, Me, SignInOptions, SignInProvider } from "@hallway/contracts";
import { signInProviders } from "@hallway/contracts";
import { handleFromName, hashEmail, normalizeName, placeholderHandle } from "@hallway/domain";
import type { Actor } from "../actor.ts";
import { fail, ok, type Outcome } from "../outcome.ts";
import { personAtKeyboard } from "./person-at-keyboard.ts";
import type {
  AttendeeRecord,
  AttendeeRepository,
  IdentityKind,
  IdentityProviders,
  IdentityRecord,
  RecordGitHubFollowing,
  VerifiedIdentity,
  WebSessionRepository,
} from "./ports.ts";
import { randomSecret, sha256Hex } from "./secrets.ts";
import { toIdentity, toMe } from "./views.ts";

export const sessionLifetimeDays = 30;

/** What sign-in hands back to the interface: the attendee and the cookie's secret. */
export interface SignedIn {
  me: Me;
  session: { secret: string; expiresAt: string };
}

/** The callback either signed someone in or added an identity to the person already signed in. */
export type Completed = ({ mode: "signed-in" } & SignedIn) | { mode: "linked"; identity: Identity };

export type DevSignIn = (input: DevSignInInput) => Promise<Outcome<SignedIn>>;
export type DevLinkGitHub = (actor: Actor, input: DevLinkGitHubInput) => Promise<Outcome<Identity>>;
export type BeginSignIn = (input: {
  actor: Actor;
  provider: SignInProvider;
  /** Add this provider to the signed-in person rather than sign in with it. */
  link: boolean;
  redirectUri: string;
}) => Promise<Outcome<{ authorizationUrl: string; state: string; linkFor?: string }>>;
export type CompleteSignIn = (input: {
  actor: Actor;
  /** From the callback's path, never from the state cookie. */
  provider: SignInProvider;
  code?: string | undefined;
  state?: string | undefined;
  /** The state the browser's short-lived cookie holds; absent when it has none. */
  expectedState?: string | undefined;
  /** The attendee a link round trip was started for, from the same cookie. */
  linkFor?: string | undefined;
  error?: string | undefined;
  redirectUri: string;
}) => Promise<Outcome<Completed>>;
export type SignOut = (input: { sessionSecret: string }) => Promise<Outcome<Record<string, never>>>;
/** `devSignIn` is the interface's answer: only it knows the bindings and the host. */
export type GetSignInOptions = (input: { devSignIn: boolean }) => Promise<Outcome<SignInOptions>>;

export const providerTitle: Record<IdentityKind, string> = {
  google: "Google",
  microsoft: "Microsoft",
  linkedin: "LinkedIn",
  github: "GitHub",
  dev: "dev sign-in",
};

export function getSignInOptions(providers: IdentityProviders): GetSignInOptions {
  return async ({ devSignIn }) => {
    const configured = signInProviders.filter((provider) => providers[provider] !== undefined);
    return ok({ devSignIn, providers: configured, linkedIn: configured.includes("linkedin") });
  };
}

interface SignInPorts {
  attendees: AttendeeRepository;
  sessions: WebSessionRepository;
  recordGitHubFollowing: RecordGitHubFollowing;
  now: () => Date;
}

/** Signs in as whoever owns this identity, or creates them, unless their verified email is someone else's. */
function signInWith({ attendees, sessions, recordGitHubFollowing, now }: SignInPorts) {
  return async (kind: IdentityKind, identity: VerifiedIdentity): Promise<Outcome<SignedIn>> => {
    const known = await attendees.identity(kind, identity.subject);
    let attendee: AttendeeRecord;
    if (known) {
      const stored = await attendees.byId(known.attendeeId);
      if (!stored) return fail("not-found", `No attendee ${known.attendeeId}.`);
      const [first] = await attendees.identitiesOf(stored.id);
      attendee = refreshed(stored, identity, first?.provider === kind);
      await attendees.saveIdentity(await identityRecord(stored.id, kind, identity, known.linkedAt));
      await attendees.save(attendee);
    } else {
      const refused = await emailBelongsToSomeoneElse(attendees, kind, identity);
      if (refused) return refused;
      const at = now();
      attendee = created(identity, await freeHandle(attendees, identity.name), at);
      await attendees.create(attendee, await identityRecord(attendee.id, kind, identity, at.toISOString()));
    }
    if (identity.following) await recordGitHubFollowing({ attendeeId: attendee.id, following: identity.following });

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
 * No merge by email (ADR 0018): a new identity whose verified email is
 * already some attendee's verified email neither signs in to that account
 * nor makes a second one. An email is not proof two accounts are one person.
 */
async function emailBelongsToSomeoneElse(
  attendees: AttendeeRepository,
  kind: IdentityKind,
  identity: VerifiedIdentity,
): Promise<Outcome<never> | undefined> {
  if (!identity.emailVerified || !identity.email) return undefined;
  const holder = await attendees.identityWithVerifiedEmail(await hashEmail(identity.email));
  if (!holder) return undefined;
  return fail(
    "account-exists",
    `There is already a Hallway account for this email. Sign in the way you did before, then add ${providerTitle[kind]} in Settings.`,
  );
}

/**
 * LinkIdentity: adds this provider account to the person signed in. Refused
 * when the account is someone else's (no silent merge) or when they already
 * have a different account of the same provider.
 */
function linkTo({ attendees, recordGitHubFollowing, now }: SignInPorts) {
  return async (attendeeId: string, kind: SignInProvider, identity: VerifiedIdentity): Promise<Outcome<Identity>> => {
    const owner = await attendees.identity(kind, identity.subject);
    if (owner && owner.attendeeId !== attendeeId) {
      return fail(
        "conflict",
        `This ${providerTitle[kind]} account is already linked to another Hallway account. Sign in with it to use that account.`,
      );
    }
    let record: IdentityRecord;
    if (owner) {
      record = await identityRecord(attendeeId, kind, identity, owner.linkedAt);
      await attendees.saveIdentity(record);
    } else {
      const mine = await attendees.identitiesOf(attendeeId);
      if (mine.some((linked) => linked.provider === kind)) {
        return fail(
          "conflict",
          `You already have a different ${providerTitle[kind]} account linked. Remove it in Settings before adding this one.`,
        );
      }
      record = await identityRecord(attendeeId, kind, identity, now().toISOString());
      await attendees.link(record);
    }
    if (identity.following) await recordGitHubFollowing({ attendeeId, following: identity.following });
    return ok(toIdentity(record));
  };
}

export interface SignInHandlers {
  devSignIn: DevSignIn;
  devLinkGitHub: DevLinkGitHub;
  beginSignIn: BeginSignIn;
  completeSignIn: CompleteSignIn;
}

export function signInHandlers(providers: IdentityProviders, ports: SignInPorts): SignInHandlers {
  const signIn = signInWith(ports);
  const link = linkTo(ports);
  const notConfigured = (provider: SignInProvider) =>
    fail("not-found", `${providerTitle[provider]} sign-in is not configured here (no ${provider.toUpperCase()}_CLIENT_ID).`);

  return {
    /**
     * Dev sign-in: believes the name it is given. The interface offers it
     * only when DEV_SIGN_IN is on (ADR 0004). The same name signs in as the
     * same attendee, so a dev can come back to their data.
     */
    devSignIn: ({ name }) => signIn("dev", { subject: normalizeName(name), name, emailVerified: false }),

    /**
     * Dev only, like dev sign-in: the end of a GitHub link round trip with
     * the account and its following list given rather than fetched, so a dev
     * server and the e2e suite reach the same link path without GitHub.
     */
    async devLinkGitHub(actor, { id, login, following }) {
      const person = personAtKeyboard(actor);
      if (!person.ok) return person;
      return link(person.value, "github", {
        subject: String(id),
        name: login,
        username: login,
        emailVerified: false,
        following: following.map((user) => ({ id: String(user.id), login: user.login })),
      });
    },

    async beginSignIn({ actor, provider, link: linking, redirectUri }) {
      const adapter = providers[provider];
      if (!adapter) return notConfigured(provider);
      let linkFor: string | undefined;
      if (linking) {
        const person = personAtKeyboard(actor);
        if (!person.ok) return person;
        linkFor = person.value;
      }
      const state = randomSecret();
      return ok({
        authorizationUrl: adapter.authorizationUrl({ state, redirectUri }),
        state,
        ...(linkFor !== undefined && { linkFor }),
      });
    },

    /**
     * The OAuth callback. `state` must equal the one this browser was given
     * at the start (held in a short-lived cookie), which is what makes a
     * callback started in someone else's browser useless here. A link round
     * trip must also end with the same person signed in who started it.
     */
    async completeSignIn({ actor, provider, code, state, expectedState, linkFor, error, redirectUri }) {
      const adapter = providers[provider];
      if (!adapter) return notConfigured(provider);
      if (!expectedState || state !== expectedState) {
        return fail("forbidden", "This sign-in was not started in this browser, or took too long. Start again.");
      }
      if (linkFor !== undefined) {
        const person = personAtKeyboard(actor);
        if (!person.ok) return person;
        if (person.value !== linkFor) {
          return fail("forbidden", "You are signed in as someone else than when you started. Start again from Settings.");
        }
      }
      const title = providerTitle[provider];
      if (error) return fail("unauthenticated", `${title} did not sign you in (${error}).`);
      if (!code) return fail("invalid", "The callback carries no authorization code.");
      const identity = await adapter.identify({ code, redirectUri });
      if (!identity) return fail("unauthenticated", `${title} did not accept the authorization code.`);
      if (linkFor !== undefined) {
        const linked = await link(linkFor, provider, identity);
        return linked.ok ? ok({ mode: "linked", identity: linked.value }) : linked;
      }
      const signedIn = await signIn(provider, identity);
      return signedIn.ok ? ok({ mode: "signed-in", ...signedIn.value }) : signedIn;
    },
  };
}

export function signOut(sessions: WebSessionRepository): SignOut {
  return async ({ sessionSecret }) => {
    await sessions.delete(await sha256Hex(sessionSecret));
    return ok({});
  };
}

interface NewHandle {
  handle: string;
  placeholder: boolean;
}

/** A handle from the name, or a random placeholder when the name gives none, free in storage. */
async function freeHandle(attendees: AttendeeRepository, name: string): Promise<NewHandle> {
  const taken = new Set<string>();
  for (;;) {
    const fromName = handleFromName(name, taken);
    const handle = fromName ?? placeholderHandle(crypto.getRandomValues(new Uint8Array(4)));
    if (!(await attendees.byHandle(handle))) return { handle, placeholder: fromName === undefined };
    taken.add(handle);
  }
}

async function identityRecord(
  attendeeId: string,
  provider: IdentityKind,
  identity: VerifiedIdentity,
  linkedAt: string,
): Promise<IdentityRecord> {
  const { email } = identity;
  const verified = identity.emailVerified && email !== undefined;
  return {
    attendeeId,
    provider,
    subject: identity.subject,
    ...(email !== undefined && { email }),
    emailVerified: verified,
    ...(verified && { verifiedEmailSha256: await hashEmail(email) }),
    ...(identity.username !== undefined && { username: identity.username }),
    linkedAt,
  };
}

/** The first identity's verified facts. The email is kept only when the provider says it is verified. */
function verifiedFacts(identity: VerifiedIdentity) {
  const email = identity.emailVerified ? identity.email : undefined;
  return { verifiedName: identity.name, ...(email ? { email } : {}) };
}

function created(identity: VerifiedIdentity, { handle, placeholder }: NewHandle, at: Date): AttendeeRecord {
  return {
    id: crypto.randomUUID(),
    handle,
    handlePlaceholder: placeholder,
    displayName: identity.name,
    ...(identity.picture ? { avatarUrl: identity.picture } : {}),
    visibility: "network",
    ...verifiedFacts(identity),
    createdAt: at.toISOString(),
  };
}

/**
 * A returning attendee. Their first identity's facts are refreshed (ADR
 * 0018: the verified name comes from the first identity); another identity
 * only fills a missing picture. What they typed is kept either way.
 */
function refreshed(known: AttendeeRecord, identity: VerifiedIdentity, isFirst: boolean): AttendeeRecord {
  if (!isFirst) {
    return !known.avatarUrl && identity.picture ? { ...known, avatarUrl: identity.picture } : known;
  }
  const { email: _email, verifiedName: _name, ...kept } = known;
  return {
    ...kept,
    ...(identity.picture ? { avatarUrl: identity.picture } : {}),
    ...verifiedFacts(identity),
  };
}
