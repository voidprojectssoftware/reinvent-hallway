// The identity handlers over plain stubs (application may not import
// infrastructure's fakes, ADR 0002). An Actor is built directly here, which is
// how any application test acts as someone.
import { describe, expect, it } from "vitest";
import type { SignInProvider } from "@hallway/contracts";
import { anonymous, type Actor } from "../actor.ts";
import { identityHandlers } from "./identity-handlers.ts";
import type {
  AgentTokenRecord,
  AttendeeRecord,
  GitHubUser,
  IdentityProvider,
  IdentityRecord,
  VerifiedIdentity,
  WebSessionRecord,
} from "./ports.ts";
import { sha256Hex } from "./secrets.ts";

/**
 * Handlers over Map stubs. Every provider is a stub that vouches for whoever
 * the test signs in as, unless the test configures fewer.
 */
function setup(options: { providers?: SignInProvider[] } = {}) {
  const attendees = new Map<string, AttendeeRecord>();
  const identities: IdentityRecord[] = [];
  const tokens = new Map<string, AgentTokenRecord>();
  const sessions = new Map<string, WebSessionRecord>();
  const feeds = new Map<string, { token: string; rotatedAt: string }>();
  const connected: [string, string][] = [];
  const followed: { attendeeId: string; following: GitHubUser[] }[] = [];
  let clock = new Date("2026-11-13T10:00:00.000Z");
  let vouchFor: VerifiedIdentity | undefined;
  const stub: IdentityProvider = {
    authorizationUrl: ({ state }) => `https://provider.example/authorize?state=${state}`,
    identify: async ({ code }) => (code === "bad" ? undefined : vouchFor),
  };
  const configured = options.providers ?? (["google", "microsoft", "linkedin", "github"] as const);
  const find = (match: (a: AttendeeRecord) => boolean) => [...attendees.values()].find(match);
  const handlers = identityHandlers({
    attendees: {
      byId: async (id) => attendees.get(id),
      byHandle: async (handle) => find((a) => a.handle === handle),
      identity: async (provider, subject) => identities.find((i) => i.provider === provider && i.subject === subject),
      identitiesOf: async (id) =>
        identities.filter((i) => i.attendeeId === id).sort((a, b) => a.linkedAt.localeCompare(b.linkedAt)),
      identityWithVerifiedEmail: async (hash) => identities.find((i) => i.verifiedEmailSha256 === hash),
      create: async (a, first) => {
        attendees.set(a.id, a);
        identities.push(first);
      },
      save: async (a) => void attendees.set(a.id, a),
      link: async (identity) => void identities.push(identity),
      saveIdentity: async (identity) => {
        const at = identities.findIndex((i) => i.provider === identity.provider && i.subject === identity.subject);
        identities[at] = identity;
      },
      unlink: async (id, provider) => {
        const at = identities.findIndex((i) => i.attendeeId === id && i.provider === provider);
        identities.splice(at, 1);
      },
    },
    agentTokens: {
      create: async (t) => void tokens.set(t.id, t),
      byId: async (id) => tokens.get(id),
      bySecretSha256: async (hash) => [...tokens.values()].find((t) => t.secretSha256 === hash),
      listFor: async (id) => [...tokens.values()].filter((t) => t.attendeeId === id),
      touch: async (id, at) => void tokens.set(id, { ...tokens.get(id)!, lastUsedAt: at }),
      revoke: async (id, at) => void tokens.set(id, { ...tokens.get(id)!, revokedAt: at }),
    },
    webSessions: {
      create: async (s) => void sessions.set(s.idSha256, s),
      byIdSha256: async (hash) => sessions.get(hash),
      delete: async (hash) => void sessions.delete(hash),
    },
    calendarFeeds: {
      replace: async (id, token, rotatedAt) => void feeds.set(id, { token, rotatedAt }),
      get: async (id) => feeds.get(id),
      ownerOf: async (token) => [...feeds].find(([, feed]) => feed.token === token)?.[0],
    },
    tieBetween: async (a, b) => ({ connected: connected.some(([x, y]) => (x === a && y === b) || (x === b && y === a)), followedByOwner: false }),
    providers: Object.fromEntries(configured.map((provider) => [provider, stub])),
    recordGitHubFollowing: async (input) => void followed.push(input),
    now: () => clock,
  });
  /** The callback, as `identity`, after a start whose state the browser kept. */
  const callback = (actor: Actor, provider: SignInProvider, identity: VerifiedIdentity, linkFor?: string) => {
    vouchFor = identity;
    return handlers.completeSignIn({
      actor,
      provider,
      code: "c",
      state: "s",
      expectedState: "s",
      ...(linkFor !== undefined && { linkFor }),
      redirectUri: "r",
    });
  };
  return {
    handlers,
    attendees,
    identities,
    tokens,
    connected,
    followed,
    callback,
    advance(days: number) {
      clock = new Date(clock.getTime() + days * 86_400_000);
    },
    /** Signs in through a provider's callback (LinkedIn unless said), as `identity`. */
    async signIn(identity: VerifiedIdentity, provider: SignInProvider = "linkedin") {
      const outcome = await callback(anonymous, provider, identity);
      if (!outcome.ok) throw new Error(outcome.error.message);
      if (outcome.value.mode !== "signed-in") throw new Error("expected a sign-in");
      return outcome.value;
    },
    /** Links `identity` to the signed-in `attendeeId`: the start, then the callback. */
    async link(attendeeId: string, provider: SignInProvider, identity: VerifiedIdentity) {
      const begun = await handlers.beginSignIn({ actor: as(attendeeId), provider, link: true, redirectUri: "r" });
      if (!begun.ok) return begun;
      return callback(as(attendeeId), provider, identity, begun.value.linkFor);
    },
  };
}

const jane: VerifiedIdentity = {
  subject: "li-jane",
  name: "Jane Doe",
  picture: "https://media.licdn.com/jane.jpg",
  email: "Jane@Example.com",
  emailVerified: true,
};
/** Another person: no email, so the email-exists rule leaves them alone. */
const someone = (subject: string, name = "Jane Doe"): VerifiedIdentity => ({ subject, name, emailVerified: false });
/** A person signed in on the web. */
const as = (attendeeId: string): Actor => ({ kind: "attendee", attendeeId, via: "session" });

describe("SignIn", () => {
  it("creates the attendee on first sign-in, with a handle from the name and the provider's verified facts", async () => {
    const world = setup();
    const { me, session } = await world.signIn(jane);
    expect(me).toMatchObject({
      handle: "jane-doe",
      displayName: "Jane Doe",
      verifiedName: "Jane Doe",
      email: "Jane@Example.com",
      avatarUrl: jane.picture,
      visibility: "network",
    });
    expect(world.identities).toEqual([
      {
        attendeeId: me.id,
        provider: "linkedin",
        subject: "li-jane",
        email: "Jane@Example.com",
        emailVerified: true,
        verifiedEmailSha256: expect.stringMatching(/^[0-9a-f]{64}$/),
        linkedAt: "2026-11-13T10:00:00.000Z",
      },
    ]);
    expect(session.expiresAt).toBe("2026-12-13T10:00:00.000Z");
  });

  it("does not take an email the provider did not verify as the attendee's", async () => {
    const world = setup();
    const { me } = await world.signIn({ ...jane, emailVerified: false });
    expect(me.email).toBeUndefined();
    expect(world.identities[0]).toMatchObject({ email: jane.email, emailVerified: false });
    expect(world.identities[0]).not.toHaveProperty("verifiedEmailSha256");
  });

  it("signs a returning attendee in as the same one, refreshing verified facts and keeping what they typed", async () => {
    const world = setup();
    const first = await world.signIn(jane);
    await world.handlers.updateProfile(as(first.me.id), { displayName: "JD", headline: "Builder" });
    const again = await world.signIn({ ...jane, name: "Jane Q. Doe", emailVerified: false });
    expect(again.me).toMatchObject({ id: first.me.id, displayName: "JD", headline: "Builder", verifiedName: "Jane Q. Doe" });
    expect(again.me.email).toBeUndefined();
    expect(world.identities).toHaveLength(1);
  });

  it("gives a second person with the same name the next free handle", async () => {
    const world = setup();
    await world.signIn(jane);
    const other = await world.signIn(someone("li-other-jane"));
    expect(other.me.handle).toBe("jane-doe-2");
  });

  it("gives a name with no Latin letter a random attendee- placeholder, marked as one", async () => {
    const world = setup();
    const olga = await world.signIn(someone("li-olga", "Ольга Петрова"));
    const taro = await world.signIn(someone("li-taro", "山田 太郎"));
    for (const { me } of [olga, taro]) {
      expect(me.handle).toMatch(/^attendee-[a-z0-9]{4}$/);
      expect(me.handlePlaceholder).toBe(true);
    }
    expect(olga.me.handle).not.toBe(taro.me.handle);
    expect((await world.signIn(jane)).me.handlePlaceholder).toBe(false);
  });

  it("keeps a placeholder handle, and the mark, when that person signs in again", async () => {
    const world = setup();
    const first = await world.signIn(someone("li-olga", "Ольга Петрова"));
    const again = await world.signIn(someone("li-olga", "Ольга Петрова"));
    expect(again.me).toMatchObject({ handle: first.me.handle, handlePlaceholder: true });
  });

  it("devSignIn signs the same name in as the same attendee, with that name verified", async () => {
    const world = setup();
    const first = await world.handlers.devSignIn({ name: "Dev Person" });
    const second = await world.handlers.devSignIn({ name: "dev  person" });
    expect(first.ok && second.ok && first.value.me.id === second.value.me.id).toBe(true);
    expect(first.ok && first.value.me.verifiedName).toBe("Dev Person");
    expect(world.identities).toMatchObject([{ provider: "dev", subject: "dev person", emailVerified: false }]);
  });

  it("keeps the same subject from two providers apart: they are two accounts", async () => {
    const world = setup();
    const viaLinkedIn = await world.signIn(someone("12345"), "linkedin");
    const viaGitHub = await world.signIn(someone("12345"), "github");
    expect(viaGitHub.me.id).not.toBe(viaLinkedIn.me.id);
  });
});

describe("no merge by email (ADR 0018)", () => {
  it("refuses a new provider whose verified email is another account's, creating nothing", async () => {
    const world = setup();
    await world.signIn(jane, "linkedin");
    const refused = await world.callback(anonymous, "google", { ...jane, subject: "g-jane", email: "jane@example.com" });
    expect(refused).toEqual({
      ok: false,
      error: {
        kind: "account-exists",
        message:
          "There is already a Hallway account for this email. Sign in the way you did before, then add Google in Settings.",
      },
    });
    expect(world.attendees.size).toBe(1);
    expect(world.identities).toHaveLength(1);
  });

  it("matches an email on any identity, not only the first", async () => {
    const world = setup();
    const { me } = await world.signIn(someone("li-sam", "Sam"));
    await world.link(me.id, "github", { subject: "1", name: "Sam", emailVerified: true, email: "sam@example.com" });
    const refused = await world.callback(anonymous, "google", {
      subject: "g-sam",
      name: "Sam",
      emailVerified: true,
      email: "SAM@example.com",
    });
    expect(refused).toMatchObject({ ok: false, error: { kind: "account-exists" } });
  });

  it("lets an unverified email through: it proves nothing either way", async () => {
    const world = setup();
    await world.signIn(jane, "linkedin");
    const other = await world.signIn({ ...jane, subject: "ms-jane", emailVerified: false }, "microsoft");
    expect(world.attendees.size).toBe(2);
    expect(other.me.email).toBeUndefined();
  });

  it("still signs the owner of that email in through the identity they already have", async () => {
    const world = setup();
    const first = await world.signIn(jane, "linkedin");
    expect((await world.signIn(jane, "linkedin")).me.id).toBe(first.me.id);
  });
});

describe("the sign-in round trip", () => {
  it("is not-found for a provider not configured here", async () => {
    const { handlers } = setup({ providers: ["github"] });
    expect(await handlers.beginSignIn({ actor: anonymous, provider: "google", link: false, redirectUri: "r" })).toMatchObject({
      ok: false,
      error: { kind: "not-found", message: expect.stringContaining("GOOGLE_CLIENT_ID") },
    });
    expect(await handlers.getSignInOptions({ devSignIn: false })).toEqual({
      ok: true,
      value: { devSignIn: false, providers: ["github"], linkedIn: false },
    });
  });

  it("lists configured providers in the order Google, Microsoft, LinkedIn, GitHub", async () => {
    const { handlers } = setup({ providers: ["github", "linkedin", "google"] });
    expect(await handlers.getSignInOptions({ devSignIn: true })).toEqual({
      ok: true,
      value: { devSignIn: true, providers: ["google", "linkedin", "github"], linkedIn: true },
    });
  });

  it("starts with a fresh random state in the authorization URL", async () => {
    const { handlers } = setup();
    const start = () => handlers.beginSignIn({ actor: anonymous, provider: "linkedin", link: false, redirectUri: "r" });
    const one = await start();
    const two = await start();
    if (!one.ok || !two.ok) throw new Error("expected ok");
    expect(one.value.state).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(one.value.authorizationUrl).toContain(one.value.state);
    expect(one.value.state).not.toBe(two.value.state);
    expect(one.value).not.toHaveProperty("linkFor");
  });

  it("refuses a callback whose state is not the one this browser holds, or when it holds none", async () => {
    const { handlers } = setup();
    for (const expectedState of ["other", undefined]) {
      expect(
        await handlers.completeSignIn({ actor: anonymous, provider: "github", code: "c", state: "s", expectedState, redirectUri: "r" }),
      ).toMatchObject({ ok: false, error: { kind: "forbidden" } });
    }
  });

  it("refuses a code the provider will not redeem, and a cancelled consent", async () => {
    const { handlers } = setup();
    const base = { actor: anonymous, provider: "microsoft" as const, state: "s", expectedState: "s", redirectUri: "r" };
    expect(await handlers.completeSignIn({ ...base, code: "bad" })).toMatchObject({
      error: { kind: "unauthenticated", message: "Microsoft did not accept the authorization code." },
    });
    expect(await handlers.completeSignIn({ ...base, error: "access_denied" })).toMatchObject({
      error: { kind: "unauthenticated" },
    });
  });

  it("hands GitHub's following list to the follows port, at sign-in and at link time", async () => {
    const world = setup();
    const following = [{ id: "583231", login: "octocat" }];
    const { me } = await world.signIn({ ...someone("101", "Gina"), username: "gina", following }, "github");
    expect(world.followed).toEqual([{ attendeeId: me.id, following }]);
    expect(world.identities[0]).toMatchObject({ provider: "github", subject: "101", username: "gina" });

    const other = await world.signIn(someone("li-hal", "Hal"));
    await world.link(other.me.id, "github", { ...someone("102", "Hal"), username: "hal", following: [] });
    expect(world.followed).toHaveLength(2);
  });
});

describe("LinkIdentity", () => {
  it("adds a provider to the person signed in, and they then sign in with either", async () => {
    const world = setup();
    const { me } = await world.signIn(jane, "linkedin");
    world.advance(1);
    const linked = await world.link(me.id, "github", {
      ...someone("42", "Jane"),
      username: "jane",
      email: "jane@users.example",
      emailVerified: true,
    });
    expect(linked).toMatchObject({
      ok: true,
      value: {
        mode: "linked",
        identity: { provider: "github", username: "jane", emailVerified: true, linkedAt: "2026-11-14T10:00:00.000Z" },
      },
    });
    expect((await world.signIn(someone("42", "Jane"), "github")).me.id).toBe(me.id);
    // The first identity's facts stay the attendee's.
    expect(world.attendees.get(me.id)).toMatchObject({ verifiedName: "Jane Doe", email: "Jane@Example.com" });
  });

  it("links an identity whose verified email is the same person's own", async () => {
    const world = setup();
    const { me } = await world.signIn(jane, "linkedin");
    expect(await world.link(me.id, "google", { ...jane, subject: "g-jane" })).toMatchObject({ ok: true });
  });

  it("refuses an identity that belongs to another attendee, without moving it", async () => {
    const world = setup();
    const owner = await world.signIn(someone("777", "Owner"), "github");
    const { me } = await world.signIn(jane);
    expect(await world.link(me.id, "github", someone("777", "Owner"))).toEqual({
      ok: false,
      error: {
        kind: "conflict",
        message: "This GitHub account is already linked to another Hallway account. Sign in with it to use that account.",
      },
    });
    expect(world.identities.find((i) => i.subject === "777")?.attendeeId).toBe(owner.me.id);
  });

  it("refuses a second account of a provider already linked", async () => {
    const world = setup();
    const { me } = await world.signIn(jane);
    await world.link(me.id, "google", someone("g-1"));
    expect(await world.link(me.id, "google", someone("g-2"))).toMatchObject({ ok: false, error: { kind: "conflict" } });
  });

  it("is idempotent for an identity the person already has", async () => {
    const world = setup();
    const { me } = await world.signIn(jane);
    expect(await world.link(me.id, "linkedin", jane)).toMatchObject({ ok: true, value: { mode: "linked" } });
    expect(world.identities).toHaveLength(1);
  });

  it("needs a person at the keyboard: refused signed out and to an agent token", async () => {
    const world = setup();
    const { me } = await world.signIn(jane);
    const start = (actor: Actor) => world.handlers.beginSignIn({ actor, provider: "google", link: true, redirectUri: "r" });
    expect(await start(anonymous)).toMatchObject({ error: { kind: "unauthenticated" } });
    expect(await start({ kind: "attendee", attendeeId: me.id, via: "agent-token" })).toMatchObject({
      error: { kind: "forbidden" },
    });
    expect(await start(as(me.id))).toMatchObject({ ok: true, value: { linkFor: me.id } });
  });

  it("refuses a callback when someone else is signed in than when the link started", async () => {
    const world = setup();
    const { me } = await world.signIn(jane);
    const other = await world.signIn(someone("li-other", "Other"));
    expect(await world.callback(as(other.me.id), "google", someone("g-x"), me.id)).toMatchObject({
      ok: false,
      error: { kind: "forbidden" },
    });
    expect(await world.callback(anonymous, "google", someone("g-x"), me.id)).toMatchObject({
      error: { kind: "unauthenticated" },
    });
    expect(world.identities.some((i) => i.subject === "g-x")).toBe(false);
  });
});

describe("ListIdentities and UnlinkIdentity", () => {
  it("lists my identities oldest first, without subjects or email hashes", async () => {
    const world = setup();
    const { me } = await world.signIn(jane);
    world.advance(1);
    await world.link(me.id, "github", { ...someone("9", "Jane"), username: "jd" });
    const listed = await world.handlers.listIdentities({ kind: "attendee", attendeeId: me.id, via: "agent-token" });
    expect(JSON.parse(JSON.stringify(listed))).toEqual({
      ok: true,
      value: {
        identities: [
          { provider: "linkedin", email: "Jane@Example.com", emailVerified: true, linkedAt: "2026-11-13T10:00:00.000Z" },
          { provider: "github", emailVerified: false, username: "jd", linkedAt: "2026-11-14T10:00:00.000Z" },
        ],
      },
    });
    expect(JSON.stringify(listed)).not.toMatch(/li-jane|[0-9a-f]{64}/);
    expect(await world.handlers.listIdentities(anonymous)).toMatchObject({ error: { kind: "unauthenticated" } });
  });

  it("unlinks one while another remains, and refuses the last", async () => {
    const world = setup();
    const { me } = await world.signIn(jane);
    await world.link(me.id, "google", someone("g-jane"));
    expect(await world.handlers.unlinkIdentity(as(me.id), { provider: "linkedin" })).toMatchObject({
      ok: true,
      value: { identities: [{ provider: "google" }] },
    });
    expect(await world.handlers.unlinkIdentity(as(me.id), { provider: "google" })).toEqual({
      ok: false,
      error: { kind: "conflict", message: "Google is your only way to sign in. Add another before removing it." },
    });
    expect(await world.handlers.unlinkIdentity(as(me.id), { provider: "github" })).toMatchObject({
      error: { kind: "not-found" },
    });
    // The unlinked LinkedIn account is free again: signing in with it makes a new account.
    expect((await world.signIn({ ...jane, emailVerified: false })).me.id).not.toBe(me.id);
  });

  it("refuses to unlink for an agent token", async () => {
    const world = setup();
    const { me } = await world.signIn(jane);
    await world.link(me.id, "google", someone("g-jane"));
    const agent: Actor = { kind: "attendee", attendeeId: me.id, via: "agent-token" };
    expect(await world.handlers.unlinkIdentity(agent, { provider: "google" })).toMatchObject({ error: { kind: "forbidden" } });
    expect(world.identities).toHaveLength(2);
  });
});

describe("Authenticate", () => {
  it("turns a live session into its attendee, and refuses it once expired or signed out", async () => {
    const world = setup();
    const { me, session } = await world.signIn(jane);
    expect(await world.handlers.authenticate({ kind: "session", secret: session.secret })).toEqual({
      ok: true,
      value: as(me.id),
    });
    world.advance(31);
    expect(await world.handlers.authenticate({ kind: "session", secret: session.secret })).toMatchObject({ ok: false });

    world.advance(-31);
    await world.handlers.signOut({ sessionSecret: session.secret });
    expect(await world.handlers.authenticate({ kind: "session", secret: session.secret })).toMatchObject({ ok: false });
  });

  it("turns an agent token into its attendee and records the use; refuses it once revoked", async () => {
    const world = setup();
    const { me } = await world.signIn(jane);
    const issued = await world.handlers.issueAgentToken(as(me.id), { label: "laptop" });
    if (!issued.ok) throw new Error("expected ok");
    expect(issued.value.secret).toMatch(/^hw_[A-Za-z0-9_-]{43}$/);
    expect(issued.value.token.prefix).toBe(issued.value.secret.slice(0, 11));

    const stored = world.tokens.get(issued.value.token.id)!;
    expect(stored.secretSha256).toBe(await sha256Hex(issued.value.secret));
    expect(JSON.stringify(stored)).not.toContain(issued.value.secret);

    world.advance(1);
    expect(await world.handlers.authenticate({ kind: "agent-token", secret: issued.value.secret })).toEqual({
      ok: true,
      value: { kind: "attendee", attendeeId: me.id, via: "agent-token" },
    });
    expect(world.tokens.get(issued.value.token.id)?.lastUsedAt).toBe("2026-11-14T10:00:00.000Z");

    await world.handlers.revokeAgentToken(as(me.id), { tokenId: issued.value.token.id });
    expect(await world.handlers.authenticate({ kind: "agent-token", secret: issued.value.secret })).toMatchObject({
      ok: false,
      error: { kind: "unauthenticated" },
    });
  });

  it("refuses a token that only shares a prefix with a real one", async () => {
    const world = setup();
    const { me } = await world.signIn(jane);
    const issued = await world.handlers.issueAgentToken(as(me.id), { label: "laptop" });
    if (!issued.ok) throw new Error("expected ok");
    const forged = issued.value.token.prefix + "x".repeat(35);
    expect(await world.handlers.authenticate({ kind: "agent-token", secret: forged })).toMatchObject({ ok: false });
  });
});

describe("agent tokens", () => {
  it("cannot be listed or revoked by anyone but their attendee", async () => {
    const world = setup();
    const { me } = await world.signIn(jane);
    const other = await world.signIn(someone("li-other"));
    const issued = await world.handlers.issueAgentToken(as(me.id), { label: "laptop" });
    if (!issued.ok) throw new Error("expected ok");
    expect(await world.handlers.listAgentTokens(as(other.me.id))).toEqual({ ok: true, value: { tokens: [] } });
    expect(await world.handlers.revokeAgentToken(as(other.me.id), { tokenId: issued.value.token.id })).toMatchObject({
      error: { kind: "not-found" },
    });
    expect(await world.handlers.issueAgentToken(anonymous, { label: "x" })).toMatchObject({ error: { kind: "unauthenticated" } });
  });
});

describe("UpdateProfile", () => {
  it("normalizes a handle and refuses a malformed, reserved or taken one", async () => {
    const world = setup();
    const { me } = await world.signIn(jane);
    await world.signIn(someone("li-bob", "Bob Smith"));
    const update = (handle: string) => world.handlers.updateProfile(as(me.id), { handle });

    expect(await update(" @Jane-D ")).toMatchObject({ ok: true, value: { handle: "jane-d" } });
    expect(await update("j_d")).toMatchObject({ error: { kind: "invalid" } });
    expect(await update("settings")).toMatchObject({ error: { kind: "conflict" } });
    expect(await update("bob-smith")).toMatchObject({ error: { kind: "conflict" } });
    expect(await update("jane-d")).toMatchObject({ ok: true });
  });

  it("clears the placeholder mark once the handle changes, not when the form is saved as it was", async () => {
    const world = setup();
    const { me } = await world.signIn(someone("li-olga", "Ольга Петрова"));
    const unchanged = await world.handlers.updateProfile(as(me.id), { handle: me.handle, headline: "Engineer" });
    expect(unchanged).toMatchObject({ ok: true, value: { handlePlaceholder: true } });
    const taken = await world.handlers.updateProfile(as(me.id), { handle: "settings" });
    expect(taken.ok).toBe(false);
    expect(world.attendees.get(me.id)?.handlePlaceholder).toBe(true);
    const chosen = await world.handlers.updateProfile(as(me.id), { handle: "olga-petrova" });
    expect(chosen).toMatchObject({ ok: true, value: { handle: "olga-petrova", handlePlaceholder: false } });
    expect(world.attendees.get(me.id)?.handlePlaceholder).toBe(false);
  });

  it("stores a claimed LinkedIn URL in one spelling, refuses one that is not LinkedIn, clears on null", async () => {
    const world = setup();
    const { me } = await world.signIn(jane);
    const update = (linkedinProfileUrl: string | null) =>
      world.handlers.updateProfile(as(me.id), { linkedinProfileUrl });
    expect(await update("linkedin.com/in/Jane-Doe/")).toMatchObject({
      value: { linkedinProfileUrl: "https://www.linkedin.com/in/jane-doe" },
    });
    expect(await update("https://example.com/jane")).toMatchObject({ error: { kind: "invalid" } });
    expect(await update(null)).toMatchObject({ ok: true, value: { linkedinProfileUrl: undefined } });
    expect(world.attendees.get(me.id)).not.toHaveProperty("linkedinProfileUrl");
  });

  it("refuses anonymous", async () => {
    const { handlers } = setup();
    expect(await handlers.getMe(anonymous)).toMatchObject({ error: { kind: "unauthenticated" } });
  });
});

describe("GetAttendee", () => {
  it("serializes the public card with no private field, for a private attendee too", async () => {
    const world = setup();
    const { me } = await world.signIn(jane);
    await world.handlers.setVisibility(as(me.id), { visibility: "private" });
    const card = await world.handlers.getAttendee(anonymous, { handle: "@jane-doe" });
    if (!card.ok) throw new Error("expected ok");
    const json = JSON.parse(JSON.stringify(card.value)) as Record<string, unknown>;
    for (const key of ["email", "verifiedName", "createdAt", "identities"]) {
      expect(json).not.toHaveProperty(key);
    }
    expect(JSON.stringify(card.value)).not.toContain("Example.com");
    expect(json).toMatchObject({ displayName: "Jane Doe", avatarUrl: jane.picture, scheduleVisible: false });
  });

  it("says whether the asker may see the schedule, by the domain's visibility rule", async () => {
    const world = setup();
    const { me } = await world.signIn(jane);
    const friend = await world.signIn(someone("li-friend", "Friend"));
    const stranger = await world.signIn(someone("li-stranger", "Stranger"));
    world.connected.push([me.id, friend.me.id]);

    const visible = async (viewer: Actor) => {
      const card = await world.handlers.getAttendee(viewer, { handle: "jane-doe" });
      return card.ok && card.value.scheduleVisible;
    };
    expect(await visible(as(friend.me.id))).toBe(true);
    expect(await visible(as(stranger.me.id))).toBe(false);
    expect(await visible(anonymous)).toBe(false);
    expect(await visible(as(me.id))).toBe(true);
  });

  it("is not-found for an unknown handle", async () => {
    const { handlers } = setup();
    expect(await handlers.getAttendee(anonymous, { handle: "nobody" })).toMatchObject({ error: { kind: "not-found" } });
  });
});

describe("calendar feed", () => {
  it("rotates to a new secret each time, and the owner can read the current one back", async () => {
    const world = setup();
    const { me } = await world.signIn(jane);
    expect(await world.handlers.getCalendarFeed(as(me.id))).toMatchObject({ error: { kind: "not-found" } });
    const one = await world.handlers.rotateCalendarFeed(as(me.id));
    const two = await world.handlers.rotateCalendarFeed(as(me.id));
    if (!one.ok || !two.ok) throw new Error("expected ok");
    expect(one.value.token).not.toBe(two.value.token);
    expect(two.value.path).toBe(`/cal/${two.value.token}.ics`);
    expect(await world.handlers.getCalendarFeed(as(me.id))).toEqual({ ok: true, value: two.value });
  });

  it("is not in Me or the public card", async () => {
    const world = setup();
    const { me } = await world.signIn(jane);
    const feed = await world.handlers.rotateCalendarFeed(as(me.id));
    if (!feed.ok) throw new Error("expected ok");
    const views = [await world.handlers.getMe(as(me.id)), await world.handlers.getAttendee(anonymous, { handle: me.handle })];
    for (const view of views) expect(JSON.stringify(view)).not.toContain(feed.value.token);
  });
});

describe("credential management needs a person, not an agent token", () => {
  it("refuses an agent token with forbidden on every token and feed handler", async () => {
    const world = setup();
    const { me } = await world.signIn(jane);
    const issued = await world.handlers.issueAgentToken(as(me.id), { label: "laptop" });
    if (!issued.ok) throw new Error("expected ok");
    const agent: Actor = { kind: "attendee", attendeeId: me.id, via: "agent-token" };
    const forbidden = { ok: false, error: { kind: "forbidden" } };

    expect(await world.handlers.issueAgentToken(agent, { label: "another" })).toMatchObject(forbidden);
    expect(await world.handlers.listAgentTokens(agent)).toMatchObject(forbidden);
    expect(await world.handlers.revokeAgentToken(agent, { tokenId: issued.value.token.id })).toMatchObject(forbidden);
    expect(await world.handlers.rotateCalendarFeed(agent)).toMatchObject(forbidden);
    expect(await world.handlers.getCalendarFeed(agent)).toMatchObject(forbidden);
    expect(world.tokens.size).toBe(1);
  });

  it("lets the same attendee act through an agent token everywhere else", async () => {
    const world = setup();
    const { me } = await world.signIn(jane);
    const agent: Actor = { kind: "attendee", attendeeId: me.id, via: "agent-token" };
    expect(await world.handlers.getMe(agent)).toMatchObject({ ok: true, value: { id: me.id } });
    expect(await world.handlers.setVisibility(agent, { visibility: "public" })).toMatchObject({ ok: true });
  });

  it("treats dev sign-in's bearer as a person", async () => {
    const world = setup();
    const { me } = await world.signIn(jane);
    const dev: Actor = { kind: "attendee", attendeeId: me.id, via: "dev" };
    expect(await world.handlers.issueAgentToken(dev, { label: "curl" })).toMatchObject({ ok: true });
  });
});
