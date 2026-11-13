// The identity handlers over plain stubs (application may not import
// infrastructure's fakes, ADR 0002). An Actor is built directly here, which is
// how any application test acts as someone.
import { describe, expect, it } from "vitest";
import { anonymous, type Actor } from "../actor.ts";
import { identityHandlers } from "./identity-handlers.ts";
import type {
  AgentTokenRecord,
  AttendeeRecord,
  IdentityProvider,
  VerifiedIdentity,
  WebSessionRecord,
} from "./ports.ts";
import { sha256Hex } from "./secrets.ts";

/**
 * Handlers over Map stubs. Unless a test brings its own provider, LinkedIn is
 * a stub that vouches for whoever `signIn` is called with.
 */
function setup(options: { linkedIn?: IdentityProvider | null } = {}) {
  const attendees = new Map<string, AttendeeRecord>();
  const tokens = new Map<string, AgentTokenRecord>();
  const sessions = new Map<string, WebSessionRecord>();
  const feeds = new Map<string, { token: string; rotatedAt: string }>();
  const connected: [string, string][] = [];
  let clock = new Date("2026-11-13T10:00:00.000Z");
  let vouchFor: VerifiedIdentity | undefined;
  const stubLinkedIn: IdentityProvider = { authorizationUrl: () => "", identify: async () => vouchFor };
  const find = (match: (a: AttendeeRecord) => boolean) => [...attendees.values()].find(match);
  const handlers = identityHandlers({
    attendees: {
      byId: async (id) => attendees.get(id),
      byHandle: async (handle) => find((a) => a.handle === handle),
      byLinkedinSub: async (sub) => find((a) => a.linkedinSub === sub),
      create: async (a) => void attendees.set(a.id, a),
      save: async (a) => void attendees.set(a.id, a),
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
    areConnected: async (a, b) => connected.some(([x, y]) => (x === a && y === b) || (x === b && y === a)),
    linkedIn: options.linkedIn === null ? undefined : (options.linkedIn ?? stubLinkedIn),
    now: () => clock,
  });
  return {
    handlers,
    attendees,
    tokens,
    connected,
    advance(days: number) {
      clock = new Date(clock.getTime() + days * 86_400_000);
    },
    /** Signs in through the LinkedIn callback, as `identity`. */
    async signIn(identity: VerifiedIdentity) {
      vouchFor = identity;
      const outcome = await handlers.completeLinkedInSignIn({ code: "c", state: "s", expectedState: "s", redirectUri: "r" });
      if (!outcome.ok) throw new Error(outcome.error.message);
      return outcome.value;
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
/** A person signed in on the web. */
const as = (attendeeId: string): Actor => ({ kind: "attendee", attendeeId, via: "session" });

describe("SignIn", () => {
  it("creates the attendee on first sign-in, with a handle from the name and LinkedIn's verified facts", async () => {
    const world = setup();
    const { me, session } = await world.signIn(jane);
    expect(me).toMatchObject({
      handle: "jane-doe",
      displayName: "Jane Doe",
      verifiedName: "Jane Doe",
      email: "Jane@Example.com",
      avatarUrl: jane.picture,
      visibility: "connections",
    });
    expect(world.attendees.get(me.id)?.verifiedEmailSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(session.expiresAt).toBe("2026-12-13T10:00:00.000Z");
  });

  it("does not store an email LinkedIn did not verify", async () => {
    const world = setup();
    const { me } = await world.signIn({ ...jane, emailVerified: false });
    expect(me.email).toBeUndefined();
    expect(world.attendees.get(me.id)).not.toHaveProperty("verifiedEmailSha256");
  });

  it("signs a returning attendee in as the same one, refreshing verified facts and keeping what they typed", async () => {
    const world = setup();
    const first = await world.signIn(jane);
    await world.handlers.updateProfile(as(first.me.id), { displayName: "JD", headline: "Builder" });
    const again = await world.signIn({ ...jane, name: "Jane Q. Doe", emailVerified: false });
    expect(again.me).toMatchObject({ id: first.me.id, displayName: "JD", headline: "Builder", verifiedName: "Jane Q. Doe" });
    expect(again.me.email).toBeUndefined();
  });

  it("gives a second person with the same name the next free handle", async () => {
    const world = setup();
    await world.signIn(jane);
    const other = await world.signIn({ ...jane, subject: "li-other-jane" });
    expect(other.me.handle).toBe("jane-doe-2");
  });

  it("gives a name with no Latin letter a random attendee- placeholder, marked as one", async () => {
    const world = setup();
    const olga = await world.signIn({ ...jane, subject: "li-olga", name: "Ольга Петрова" });
    const taro = await world.signIn({ ...jane, subject: "li-taro", name: "山田 太郎" });
    for (const { me } of [olga, taro]) {
      expect(me.handle).toMatch(/^attendee-[a-z0-9]{4}$/);
      expect(me.handlePlaceholder).toBe(true);
    }
    expect(olga.me.handle).not.toBe(taro.me.handle);
    expect((await world.signIn(jane)).me.handlePlaceholder).toBe(false);
  });

  it("keeps a placeholder handle, and the mark, when that person signs in again", async () => {
    const world = setup();
    const first = await world.signIn({ ...jane, subject: "li-olga", name: "Ольга Петрова" });
    const again = await world.signIn({ ...jane, subject: "li-olga", name: "Ольга Петрова" });
    expect(again.me).toMatchObject({ handle: first.me.handle, handlePlaceholder: true });
  });

  it("devSignIn signs the same name in as the same attendee, with that name verified", async () => {
    const world = setup();
    const first = await world.handlers.devSignIn({ name: "Dev Person" });
    const second = await world.handlers.devSignIn({ name: "dev  person" });
    expect(first.ok && second.ok && first.value.me.id === second.value.me.id).toBe(true);
    expect(first.ok && first.value.me.verifiedName).toBe("Dev Person");
  });
});

describe("LinkedIn sign-in", () => {
  const linkedIn: IdentityProvider = {
    authorizationUrl: ({ state }) => `https://linkedin.example/authorize?state=${state}`,
    identify: async ({ code }) => (code === "good" ? jane : undefined),
  };

  it("is not-found when LinkedIn is not configured", async () => {
    const { handlers } = setup({ linkedIn: null });
    expect(await handlers.beginLinkedInSignIn({ redirectUri: "r" })).toMatchObject({ ok: false, error: { kind: "not-found" } });
  });

  it("starts with a fresh random state in the authorization URL", async () => {
    const { handlers } = setup({ linkedIn });
    const one = await handlers.beginLinkedInSignIn({ redirectUri: "r" });
    const two = await handlers.beginLinkedInSignIn({ redirectUri: "r" });
    if (!one.ok || !two.ok) throw new Error("expected ok");
    expect(one.value.state).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(one.value.authorizationUrl).toContain(one.value.state);
    expect(one.value.state).not.toBe(two.value.state);
  });

  it("refuses a callback whose state is not the one this browser holds, or when it holds none", async () => {
    const { handlers } = setup({ linkedIn });
    for (const expectedState of ["other", undefined]) {
      expect(
        await handlers.completeLinkedInSignIn({ code: "good", state: "s", expectedState, redirectUri: "r" }),
      ).toMatchObject({ ok: false, error: { kind: "forbidden" } });
    }
  });

  it("refuses a code LinkedIn will not redeem, and a cancelled consent", async () => {
    const { handlers } = setup({ linkedIn });
    const base = { state: "s", expectedState: "s", redirectUri: "r" };
    expect(await handlers.completeLinkedInSignIn({ ...base, code: "bad" })).toMatchObject({ error: { kind: "unauthenticated" } });
    expect(await handlers.completeLinkedInSignIn({ ...base, error: "user_cancelled_login" })).toMatchObject({
      error: { kind: "unauthenticated" },
    });
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
    const other = await world.signIn({ ...jane, subject: "li-other" });
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
    await world.signIn({ ...jane, subject: "li-bob", name: "Bob Smith" });
    const update = (handle: string) => world.handlers.updateProfile(as(me.id), { handle });

    expect(await update(" @Jane-D ")).toMatchObject({ ok: true, value: { handle: "jane-d" } });
    expect(await update("j_d")).toMatchObject({ error: { kind: "invalid" } });
    expect(await update("settings")).toMatchObject({ error: { kind: "conflict" } });
    expect(await update("bob-smith")).toMatchObject({ error: { kind: "conflict" } });
    expect(await update("jane-d")).toMatchObject({ ok: true });
  });

  it("clears the placeholder mark once the handle changes, not when the form is saved as it was", async () => {
    const world = setup();
    const { me } = await world.signIn({ ...jane, subject: "li-olga", name: "Ольга Петрова" });
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
    for (const key of ["email", "linkedinSub", "verifiedName", "verifiedEmailSha256", "createdAt"]) {
      expect(json).not.toHaveProperty(key);
    }
    expect(JSON.stringify(card.value)).not.toContain("Example.com");
    expect(json).toMatchObject({ displayName: "Jane Doe", avatarUrl: jane.picture, scheduleVisible: false });
  });

  it("says whether the asker may see the schedule, by the domain's visibility rule", async () => {
    const world = setup();
    const { me } = await world.signIn(jane);
    const friend = await world.signIn({ ...jane, subject: "li-friend", name: "Friend" });
    const stranger = await world.signIn({ ...jane, subject: "li-stranger", name: "Stranger" });
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
