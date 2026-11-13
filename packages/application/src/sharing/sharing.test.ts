// The sharing handlers over plain stubs (application may not import
// infrastructure's fakes, ADR 0002): who gets which entries, the version that
// goes in the share card's URL, and the calendar token as the credential.
import type { Event } from "@hallway/contracts";
import type { PlanEntry, Visibility } from "@hallway/domain";
import { describe, expect, it } from "vitest";
import { anonymous, type Actor } from "../actor.ts";
import type { AttendeeRecord } from "../identity/ports.ts";
import type { CatalogSession, ScheduleRepository } from "../schedule/schedule-repository.ts";
import { sharingHandlers } from "./shared-schedule.ts";

const event: Event = {
  eventId: "reinvent2026",
  name: "re:Invent 2026",
  timezone: "America/Los_Angeles",
  startDate: "2026-11-30T05:30-08:00",
  endDate: "2026-12-04T23:59-08:00",
};

const session = (sessionId: string, startsAt: string): CatalogSession => ({
  sessionId,
  eventId: "reinvent2026",
  code: sessionId.toUpperCase(),
  title: `Session ${sessionId}`,
  venue: "Venetian",
  startsAt,
  endsAt: startsAt.replace("T18", "T19"),
  lastSeenAt: "2026-11-13T00:00:00.000Z",
});

function setup(visibility: Visibility) {
  const owner: AttendeeRecord = {
    id: "a-owner",
    handle: "sam",
    handlePlaceholder: false,
    displayName: "Sam Okafor",
    headline: "Platform Engineer",
    visibility,
    email: "sam@example.test",
    createdAt: "2026-11-13T00:00:00.000Z",
  };
  const entries: PlanEntry[] = [
    { attendeeId: owner.id, sessionId: "eks1", intent: "reserved", source: "agent-sync", invited: false, hidden: false, addedAt: "x" },
    { attendeeId: owner.id, sessionId: "secret", intent: "interested", source: "manual", invited: false, hidden: true, addedAt: "x" },
  ];
  const sessions = new Map([
    ["eks1", session("eks1", "2026-11-30T18:00:00.000Z")],
    ["secret", session("secret", "2026-12-01T18:00:00.000Z")],
  ]);
  const feeds = new Map<string, string>();
  const connections = new Set<string>();
  const schedule = {
    schedule: async (attendeeId: string) =>
      attendeeId === owner.id ? entries.map((entry) => ({ entry, session: sessions.get(entry.sessionId)! })) : [],
  } as unknown as ScheduleRepository;
  const handlers = sharingHandlers({
    attendees: {
      byId: async (id) => (id === owner.id ? owner : undefined),
      byHandle: async (handle) => (handle === owner.handle ? owner : undefined),
      identity: async () => undefined,
      identitiesOf: async () => [],
      identityWithVerifiedEmail: async () => undefined,
      create: async () => undefined,
      save: async () => undefined,
      link: async () => undefined,
      saveIdentity: async () => undefined,
      unlink: async () => undefined,
    },
    calendarFeeds: {
      replace: async (id, token) => void feeds.set(id, token),
      get: async (id) => (feeds.has(id) ? { token: feeds.get(id)!, rotatedAt: "x" } : undefined),
      ownerOf: async (token) => [...feeds].find(([, t]) => t === token)?.[0],
    },
    events: { get: async (id) => (id === event.eventId ? event : undefined) },
    schedule,
    tieBetween: async (a, b) => ({ connected: connections.has([a, b].sort().join("|")), followedByOwner: false }),
    sessionUrlTemplate: "https://example.test/catalog?search={code}",
    invitePath: async (attendee) => `/@${attendee.handle}?invite=inv-1`,
  });
  return { owner, entries, sessions, feeds, connections, handlers };
}

const attendee = (attendeeId: string, via: "session" | "agent-token" = "session"): Actor => ({
  kind: "attendee",
  attendeeId,
  via,
});
const ids = (outcome: { ok: boolean; value?: { entries: { session: { sessionId: string } }[] } }) =>
  outcome.value?.entries.map((e) => e.session.sessionId);

describe("getSharedSchedule", () => {
  it("shows a public schedule to anyone, without its hidden entries, with session links", async () => {
    const { handlers } = setup("public");
    const shared = await handlers.getSharedSchedule(anonymous, { handle: "SAM" });
    expect(shared.ok && shared.value.scheduleVisible).toBe(true);
    expect(ids(shared)).toEqual(["eks1"]);
    expect(shared.ok && shared.value.entries[0]!.session.url).toBe("https://example.test/catalog?search=EKS1");
  });

  it("shows a connections-only schedule as the card alone to a stranger, and in full to a connection", async () => {
    const { handlers, connections } = setup("network");
    const stranger = await handlers.getSharedSchedule(anonymous, { handle: "sam" });
    expect(stranger.ok && stranger.value.scheduleVisible).toBe(false);
    expect(ids(stranger)).toEqual([]);
    connections.add(["a-friend", "a-owner"].join("|"));
    expect(ids(await handlers.getSharedSchedule(attendee("a-friend"), { handle: "sam" }))).toEqual(["eks1"]);
  });

  it("never carries a private field", async () => {
    const { handlers } = setup("public");
    const shared = await handlers.getSharedSchedule(anonymous, { handle: "sam" });
    expect(JSON.stringify(shared)).not.toMatch(/sub-sam|sam@example/);
  });

  it("changes its version when what it shows changes, and only then", async () => {
    const { handlers, entries, sessions } = setup("public");
    const version = async () => {
      const shared = await handlers.getSharedSchedule(anonymous, { handle: "sam" });
      return shared.ok ? shared.value.version : "";
    };
    const first = await version();
    expect(first).toMatch(/^[0-9a-f]{16}$/);
    expect(await version()).toBe(first);
    // A hidden entry changing changes nothing anyone sees.
    entries[1]!.intent = "reserved";
    expect(await version()).toBe(first);
    entries[1]!.hidden = false;
    const unhidden = await version();
    expect(unhidden).not.toBe(first);
    sessions.set("eks1", { ...sessions.get("eks1")!, venue: "Wynn" });
    expect(await version()).not.toBe(unhidden);
  });

  it("is not-found for an unknown handle", async () => {
    const { handlers } = setup("public");
    expect((await handlers.getSharedSchedule(anonymous, { handle: "nobody" })).ok).toBe(false);
  });
});

describe("exportCalendar", () => {
  it("opens the owner's schedule, hidden entries left out, even when it is private", async () => {
    const { handlers, feeds } = setup("private");
    feeds.set("a-owner", "tok-1");
    expect(ids(await handlers.exportCalendar({ token: "tok-1" }))).toEqual(["eks1"]);
  });

  it("refuses a token that was rotated away", async () => {
    const { handlers, feeds } = setup("public");
    feeds.set("a-owner", "tok-2");
    const old = await handlers.exportCalendar({ token: "tok-1" });
    expect(old.ok ? "opened" : old.error.kind).toBe("not-found");
  });
});

describe("getShareLinks", () => {
  it("gives the page, the versioned image and, to a person signed in, the feed and the invite link", async () => {
    const { handlers, feeds } = setup("network");
    feeds.set("a-owner", "tok-1");
    const links = await handlers.getShareLinks(attendee("a-owner"), { origin: "https://hallway.example" });
    expect(links.ok && links.value).toEqual({
      pageUrl: "https://hallway.example/@sam",
      imageUrl: expect.stringMatching(/^https:\/\/hallway\.example\/og\/sam\.png\?v=[0-9a-f]{16}$/),
      calendarUrl: "https://hallway.example/cal/tok-1.ics",
      inviteUrl: "https://hallway.example/@sam?invite=inv-1",
    });
  });

  it("leaves the feed and the invite link out for an agent token, and the feed when there is none yet", async () => {
    const { handlers, feeds } = setup("public");
    const none = await handlers.getShareLinks(attendee("a-owner"), { origin: "https://hallway.example" });
    expect(none.ok && none.value.calendarUrl).toBeUndefined();
    feeds.set("a-owner", "tok-1");
    const agent = await handlers.getShareLinks(attendee("a-owner", "agent-token"), { origin: "https://hallway.example" });
    expect(agent.ok && agent.value.calendarUrl).toBeUndefined();
    expect(agent.ok && agent.value.inviteUrl).toBeUndefined();
    expect(agent.ok && agent.value.pageUrl).toBe("https://hallway.example/@sam");
  });

  it("asks an anonymous caller to sign in", async () => {
    const { handlers } = setup("public");
    const links = await handlers.getShareLinks(anonymous, { origin: "https://hallway.example" });
    expect(links.ok ? "ok" : links.error.kind).toBe("unauthenticated");
  });
});
