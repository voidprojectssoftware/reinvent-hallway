// Issue #22: the agent journey, end to end, against the real Worker.
//
// Two people sign in on the web (dev sign-in) and each issues an agent token.
// Each scripted agent then does what a real one does: reads its attendee's
// schedule from the AWS Events MCP server (a fake, fake-aws-events-mcp.ts),
// and pushes it to Hallway's /mcp with `sync_my_schedule`, carrying the agent
// token. Ben hides one session on the web, Ada connects through Ben's share
// link, and Ada's agent plans around Ben: who is going, the network agenda,
// a time to meet. Ben's hidden session must never reach Ada, on any path.
// Session abstracts reach an agent only once an abstract its own attendee
// synced matches another attendee's (never a sync forged from what Hallway
// shows), and never a signed-out caller, a link preview, the share image or
// the calendar feed (ADR 0025).
//
// Agent A's AWS data is the fixture apps/api's tests use; agent B's overlaps
// it on four sessions and adds three of Ben's own (fixtures/).
import { readFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { type AwsScheduleFixture, connectFakeAwsEvents } from "./fake-aws-events-mcp.ts";

const hallway = inject("hallwayUrl");
const eventId = "reinvent2026";
const tuesday = "2026-12-01";

const fixture = (path: string): AwsScheduleFixture => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));
const adaAws = fixture("../apps/api/src/schedule-fixtures/aws-reinvent2026-schedule.json");
const benAws = fixture("./fixtures/aws-reinvent2026-schedule-b.json");

// ---- The person at the keyboard: the web app's REST calls, with a cookie ----

interface Person {
  name: string;
  id: string;
  handle: string;
  cookie: string;
}

async function rest<T>(method: string, path: string, cookie: string, body?: unknown): Promise<T> {
  const response = await fetch(
    `${hallway}${path}`,
    body === undefined
      ? { method, headers: { cookie } }
      : { method, headers: { cookie, "content-type": "application/json" }, body: JSON.stringify(body) },
  );
  if (!response.ok) throw new Error(`${method} ${path}: ${response.status} ${await response.text()}`);
  return (await response.json()) as T;
}

async function signIn(name: string): Promise<Person> {
  const response = await fetch(`${hallway}/api/dev/sign-in`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name }),
  });
  expect(response.status, await response.clone().text()).toBe(200);
  const cookie = response.headers
    .getSetCookie()
    .map((header) => header.split(";")[0]!)
    .join("; ");
  const me = (await response.json()) as { id: string; handle: string };
  return { name, id: me.id, handle: me.handle, cookie };
}

const issueAgentToken = async (person: Person) =>
  (await rest<{ secret: string }>("POST", "/api/me/tokens", person.cookie, { label: `${person.name}'s agent` })).secret;

// ---- The agent: an MCP client of AWS and of Hallway ----

// `any`, deliberately: the suite is a black-box client and imports nothing of
// Hallway's, contracts included. The SDK has already checked each result
// against the tool's advertised output schema; the assertions check the rest.
type Structured = Record<string, any>;

class Agent {
  private constructor(
    readonly hallway: Client,
    readonly aws: Client,
  ) {}

  static async start(name: string, token: string, awsData: AwsScheduleFixture) {
    const hallwayClient = new Client({ name: `${name}-agent`, version: "0.0.0" });
    await hallwayClient.connect(
      new StreamableHTTPClientTransport(new URL(`${hallway}/mcp`), {
        requestInit: { headers: { authorization: `Bearer ${token}` } },
      }),
    );
    const agent = new Agent(hallwayClient, await connectFakeAwsEvents(awsData));
    // Listing first is what a real agent does, and it arms the SDK's check of
    // every structured result against each tool's output schema.
    await agent.aws.listTools();
    await agent.hallway.listTools();
    return agent;
  }

  /** Calls a tool and returns its structured result, throwing a refusal's text. */
  static async call(client: Client, name: string, args: Structured = {}): Promise<Structured> {
    const result = await client.callTool({ name, arguments: args });
    const text = (result.content as { type: string; text?: string }[]).map((part) => part.text ?? "").join("");
    if (result.isError) throw new Error(`${name} refused: ${text}`);
    return result.structuredContent as Structured;
  }

  tool(name: string, args: Structured = {}) {
    return Agent.call(this.hallway, name, args);
  }

  /** The steps `sync_my_schedule`'s description gives an agent, followed to the letter. */
  async syncFromAws() {
    const { schedule } = await Agent.call(this.aws, "GetSchedule", { eventId });
    const ids = [...new Set<string>([...schedule.reserved, ...schedule.favorites])];
    const sessions = [];
    for (const sessionId of ids) sessions.push((await Agent.call(this.aws, "GetSession", { eventId, sessionId })).session);
    return this.tool("sync_my_schedule", {
      eventId,
      sessions,
      favorites: schedule.favorites,
      reserved: schedule.reserved,
      invitedSessions: schedule.invitedSessions ?? [],
    });
  }

  async close() {
    await Promise.allSettled([this.hallway.close(), this.aws.close()]);
  }
}

const names = (people: { displayName: string }[]) => people.map((person) => person.displayName);
const codes = (items: { session: { code?: string } }[]) => items.map((item) => item.session.code);

describe("two agents sync from AWS and plan around each other", () => {
  let ada: Person;
  let ben: Person;
  let adaAgent: Agent;
  let benAgent: Agent;

  beforeAll(async () => {
    [ada, ben] = [await signIn("Ada Lovelace"), await signIn("Ben Okafor")];
    adaAgent = await Agent.start("ada", await issueAgentToken(ada), adaAws);
    benAgent = await Agent.start("ben", await issueAgentToken(ben), benAws);
  });

  afterAll(async () => {
    await adaAgent?.close();
    await benAgent?.close();
  });

  it("each agent's token is its own attendee on /mcp", async () => {
    expect((await adaAgent.tool("whoami")).handle).toBe(ada.handle);
    expect((await benAgent.tool("whoami")).handle).toBe(ben.handle);
  });

  it("each agent reads its schedule from AWS and syncs it", async () => {
    const adaSync = await adaAgent.syncFromAws();
    expect(adaSync).toMatchObject({ added: 15, removed: 0, sessionsStored: 15, missingSessions: [] });

    // Ada's agent is the first to report any session, so nothing corroborates
    // her abstracts yet and she reads none (issue #83). Ben's has not synced,
    // and a signed-out caller never reads one.
    const aim = { eventId, sessionId: "s-aim3315" };
    for (const agent of [adaAgent, benAgent]) {
      expect(await agent.tool("get_session", aim)).not.toHaveProperty("abstract");
      expect(JSON.stringify(await agent.tool("search_sessions", { eventId, limit: 200 }))).not.toContain("ABSTRACT-TEXT");
    }
    for (const path of [`/api/events/${eventId}/sessions/s-aim3315`, `/api/events/${eventId}/sessions?limit=200`]) {
      const signedOut = await fetch(`${hallway}${path}`);
      expect(signedOut.status).toBe(200);
      expect(await signedOut.text()).not.toContain("ABSTRACT-TEXT");
    }

    // Ben's agent reports four of Ada's sessions with the same abstracts AWS
    // gave hers: each corroborates the other, and both read abstracts now.
    const benSync = await benAgent.syncFromAws();
    expect(benSync).toMatchObject({ added: 7, removed: 0, sessionsStored: 7, missingSessions: [] });

    const again = await benAgent.syncFromAws();
    expect(again).toMatchObject({ added: 0, removed: 0, changed: 0, unchanged: 7 });

    const mine = await benAgent.tool("get_my_schedule", { eventId });
    const intents = Object.fromEntries(mine.entries.map((entry: Structured) => [entry.session.code, entry.intent]));
    expect(intents).toEqual({
      AIM3315: "reserved",
      GAM301: "reserved",
      SVS401: "interested",
      CNT320: "interested",
      DAT302: "interested",
      KEY002: "interested",
      IOT220: "interested",
    });
    expect(JSON.stringify(mine)).not.toContain("ABSTRACT-TEXT");
    for (const agent of [adaAgent, benAgent]) {
      expect((await agent.tool("get_session", aim)).abstract).toMatch(/^ABSTRACT-TEXT-AIM3315/);
      const found = await agent.tool("search_sessions", { eventId, q: "AIM3315" });
      expect(found.sessions[0].abstract).toMatch(/^ABSTRACT-TEXT-AIM3315/);
    }
  });

  it("a sync forged from Hallway's public session data unlocks no abstract (issue #83)", async () => {
    const fay = await signIn("Fay Forger");
    // Fay has no AWS account to read: her AWS server has nothing on it.
    const noAws: AwsScheduleFixture = { schedule: { reserved: [], favorites: [], personalTime: [] }, sessions: [] };
    const fayAgent = await Agent.start("fay", await issueAgentToken(fay), noAws);
    try {
      // Everything Hallway shows a signed-out caller, put back in AWS's shape.
      const response = await fetch(`${hallway}/api/events/${eventId}/sessions?limit=200`);
      const { sessions: visible } = (await response.json()) as { sessions: Structured[] };
      expect(visible.length).toBeGreaterThan(10);
      const asAws = (session: Structured, abstract?: string) => ({
        sessionId: session.sessionId,
        abbreviation: session.code,
        title: session.title,
        type: session.type,
        level: session.level,
        venue: session.venue,
        room: session.room,
        isAllDaySession: session.isAllDay,
        speakers: (session.speakers ?? []).map((name: string) => ({ name })),
        topics: session.topics,
        tracks: session.tracks,
        services: session.services,
        areasOfInterest: session.areasOfInterest,
        roles: session.roles,
        ...(abstract === undefined ? {} : { abstract }),
      });
      const favorites = visible.map((session) => session.sessionId);
      for (const guess of [undefined, (s: Structured) => `${s.title}. ${s.speakers?.join(", ")} on ${s.topics?.join(", ")}.`]) {
        const sessions = visible.map((session) => asAws(session, guess?.(session)));
        const result = await fayAgent.tool("sync_my_schedule", { eventId, sessions, favorites, reserved: [] });
        expect(result.sessionsStored).toBe(visible.length);
        expect(await fayAgent.tool("get_session", { eventId, sessionId: "s-aim3315" })).not.toHaveProperty("abstract");
        expect(JSON.stringify(await fayAgent.tool("search_sessions", { eventId, limit: 200 }))).not.toContain("ABSTRACT-TEXT");
      }
      // The honest reporters still read theirs.
      expect((await adaAgent.tool("get_session", { eventId, sessionId: "s-aim3315" })).abstract).toMatch(/^ABSTRACT-TEXT-AIM3315/);
    } finally {
      await fayAgent.close();
    }
  });

  it("before they connect, Ben's week is not Ada's to see", async () => {
    await expect(adaAgent.tool("get_person_schedule", { handle: ben.handle, eventId })).rejects.toThrow(/forbidden/);
    const going = await adaAgent.tool("who_is_going", { eventId, sessionIds: ["s-aim3315"] });
    expect(going.sessions).toEqual([{ sessionId: "s-aim3315", people: [] }]);
  });

  it("Ben hides one session, and Ada connects through Ben's share link", async () => {
    const hidden = await rest<{ hidden: boolean }>(
      "PATCH",
      `/api/events/${eventId}/my-schedule/entries/s-cnt320`,
      ben.cookie,
      { hidden: true },
    );
    expect(hidden.hidden).toBe(true);

    const invite = await rest<{ token: string }>("GET", "/api/me/invite", ben.cookie);
    await rest("POST", `/api/attendees/${ben.handle}/connect`, ada.cookie, { invite: invite.token });

    expect(names((await adaAgent.tool("list_my_network")).people.map((p: Structured) => p.person))).toEqual([
      ben.name,
    ]);
    expect(names((await benAgent.tool("list_my_connections")).people.map((p: Structured) => p.person))).toEqual([
      ada.name,
    ]);
  });

  it("Ada's agent sees Ben's schedule without the hidden session", async () => {
    const schedule = await adaAgent.tool("get_person_schedule", { handle: ben.handle, eventId });
    expect(schedule.entries.map((entry: Structured) => entry.session.code)).toEqual([
      "AIM3315",
      "GAM301",
      "SVS401",
      "DAT302",
      "KEY002",
      "IOT220",
    ]);
    expect(JSON.stringify(schedule)).not.toContain("ABSTRACT-TEXT");
  });

  it("who_is_going names Ben on the sessions they share, with his intent, and not on the hidden one", async () => {
    const going = await adaAgent.tool("who_is_going", {
      eventId,
      sessionIds: ["s-aim3315", "s-svs401", "s-cnt320", "s-dat302", "s-sec205"],
    });
    expect(going.sessions.map((s: Structured) => [s.sessionId, names(s.people)])).toEqual([
      ["s-aim3315", [ben.name]],
      ["s-svs401", [ben.name]],
      ["s-cnt320", []],
      ["s-dat302", [ben.name]],
      ["s-sec205", []],
    ]);
    const intents = going.sessions.flatMap((s: Structured) => s.people.map((p: Structured) => [s.sessionId, p.intent]));
    expect(intents).toEqual([
      ["s-aim3315", "reserved"],
      ["s-svs401", "interested"],
      ["s-dat302", "interested"],
    ]);
  });

  it("list_my_network counts Ben's sessions Ada may see, and those she shares, without the hidden one", async () => {
    // Ben has seven; CNT320 is hidden, so six. Of those Ada also plans AIM3315, SVS401, DAT302
    // and the Tuesday keynote.
    const listed = await adaAgent.tool("list_my_network", { eventId });
    expect(listed.people).toEqual([
      expect.objectContaining({ person: expect.objectContaining({ handle: ben.handle }), sessions: 6, sharedWithMe: 4 }),
    ]);
    const plain = await adaAgent.tool("list_my_network");
    expect(plain.people[0]).not.toHaveProperty("sessions");
  });

  it("network_agenda lists what Ben goes to on Tuesday morning, hidden session left out", async () => {
    const agenda = await adaAgent.tool("network_agenda", { eventId, day: tuesday, from: "08:00", to: "13:00" });
    expect(codes(agenda.items)).toEqual(["AIM3315", "GAM301", "SVS401"]);
    for (const item of agenda.items) expect(names(item.people)).toEqual([ben.name]);
    expect(agenda.items[0].session.url).toContain("AIM3315");
  });

  it("find_meeting_gaps finds Tuesday windows free for both, around what Ada may see of Ben", async () => {
    // Ada (all-day expo does not block): 08:30-09:30, 11:00-12:00, 14:00-15:00, 16:00-18:00.
    // Ben, as Ada sees him: 08:30-09:30, 10:00-10:45, 11:00-12:00, 14:00-15:00.
    // Ben's hidden 12:30-13:30 is invisible to Ada, so it must not split the lunch gap.
    const gaps = await adaAgent.tool("find_meeting_gaps", { eventId, handle: ben.handle, day: tuesday });
    expect(gaps.with.handle).toBe(ben.handle);
    expect(gaps.gaps.map((gap: Structured) => `${gap.start}-${gap.end}`)).toEqual([
      "08:00-08:30",
      "09:30-10:00",
      "12:00-14:00",
      "15:00-16:00",
    ]);
  });

  it("Ada's agent joins Ben's chalk talk, and Ben's agent sees her going", async () => {
    const entry = await adaAgent.tool("add_to_plan", { eventId, sessionId: "s-gam301" });
    expect(entry).toMatchObject({ sessionId: "s-gam301", intent: "interested", source: "manual" });

    const going = await benAgent.tool("who_is_going", { eventId, sessionIds: ["s-gam301"] });
    expect(names(going.sessions[0].people)).toEqual([ada.name]);

    // Ada's next sync from AWS keeps the session she added on Hallway.
    expect(await adaAgent.syncFromAws()).toMatchObject({ added: 0, removed: 0, unchanged: 15 });
    const mine = await adaAgent.tool("get_my_schedule", { eventId });
    expect(mine.entries.map((e: Structured) => e.sessionId)).toContain("s-gam301");
  });

  it("a third agent cannot rewrite a session on Ada's schedule that is not on its own (hunt F6)", async () => {
    const cy = await signIn("Cy Ramos");
    const cyAgent = await Agent.start("cy", await issueAgentToken(cy), benAws);
    try {
      const before = (await adaAgent.tool("get_my_schedule", { eventId })).entries.find(
        (entry: Structured) => entry.sessionId === "s-sec205",
      ).session;
      // A copying mistake, or malice: SEC205's id with another title and time,
      // sent beside Cy's own favorite.
      const poisoned = {
        sessionId: "s-sec205",
        title: "CANCELLED, see you at the bar",
        abbreviation: "SEC205",
        sessionTime: { date: "2026-12-04", time: "06:00", length: "5" },
      };
      const result = await cyAgent.tool("sync_my_schedule", {
        eventId,
        sessions: [poisoned],
        favorites: ["s-aim3315"],
        reserved: [],
      });
      expect(result).toMatchObject({ added: 1, sessionsStored: 0 });

      const after = (await adaAgent.tool("get_my_schedule", { eventId })).entries.find(
        (entry: Structured) => entry.sessionId === "s-sec205",
      ).session;
      expect(after).toEqual(before);
      expect(after.title).toBe("Identity for agents: tokens, scopes and blast radius");
      const found = await benAgent.tool("search_sessions", { eventId, q: "SEC205" });
      expect(found.sessions.map((s: Structured) => s.title)).toEqual([before.title]);
    } finally {
      await cyAgent.close();
    }
  });

  // Issue #54: the mistakes models make most, each answered with a refusal or
  // a field the agent can act on with its own tools, and the recovery that follows.
  describe("an agent recovers from the mistakes models make", () => {
    const refusal = async (agent: Agent, name: string, args: Structured) => {
      const result = await agent.hallway.callTool({ name, arguments: args });
      expect(result.isError, `${name} should refuse`).toBe(true);
      return JSON.parse((result.content as { text: string }[])[0]!.text) as { kind: string; message: string };
    };

    it("last year's date is refused with the event's dates, and the right year answers", async () => {
      const refused = await refusal(adaAgent, "find_meeting_gaps", { eventId, handle: ben.handle, day: "2025-12-01" });
      expect(refused).toMatchObject({ kind: "invalid", message: expect.stringContaining("2026-11-30 to 2026-12-04") });
      const gaps = await adaAgent.tool("find_meeting_gaps", { eventId, handle: ben.handle, day: tuesday, to: "24:00" });
      expect(gaps.gaps.at(-1).end).toBe("24:00");
      expect(gaps.unplacedSessions).toEqual([]);
    });

    it("a code where an id belongs is named, found with search_sessions, and accepted where it is unambiguous", async () => {
      const going = await adaAgent.tool("who_is_going", { eventId, sessionIds: ["IOT220"] });
      expect(going.unknownSessions).toEqual(["IOT220"]);
      const found = await adaAgent.tool("search_sessions", { eventId, q: "IOT220" });
      expect(found).toMatchObject({ total: 1, truncated: false });
      const id = found.sessions[0].sessionId;
      expect(names((await adaAgent.tool("who_is_going", { eventId, sessionIds: [id] })).sessions[0].people)).toEqual([ben.name]);

      expect(await adaAgent.tool("add_to_plan", { eventId, sessionId: "IOT220" })).toMatchObject({ sessionId: id, source: "manual" });
      expect(await adaAgent.tool("remove_from_plan", { eventId, sessionId: "IOT220" })).toMatchObject({ sessionId: id });
    });

    it("removing a synced session is refused toward set_entry_hidden, which keeps it from Ben", async () => {
      const refused = await refusal(adaAgent, "remove_from_plan", { eventId, sessionId: "s-aim3315" });
      expect(refused).toMatchObject({ kind: "conflict", message: expect.stringContaining("set_entry_hidden") });
      expect(await adaAgent.tool("set_entry_hidden", { eventId, sessionId: "s-aim3315", hidden: true })).toMatchObject({
        hidden: true,
      });
      const going = await benAgent.tool("who_is_going", { eventId, sessionIds: ["s-aim3315"] });
      expect(going.sessions[0].people).toEqual([]);
      await adaAgent.tool("set_entry_hidden", { eventId, sessionId: "s-aim3315", hidden: false });
      expect(names((await benAgent.tool("who_is_going", { eventId, sessionIds: ["s-aim3315"] })).sessions[0].people)).toEqual([
        ada.name,
      ]);
    });

    it("a re-serialized AWS session syncs: numbers for minutes and nulls read, a 12-hour time is reported", async () => {
      const dee = await signIn("Dee Marsh");
      const deeAgent = await Agent.start("dee", await issueAgentToken(dee), benAws);
      try {
        const { schedule } = await Agent.call(deeAgent.aws, "GetSchedule", { eventId });
        const [first, second] = schedule.favorites as string[];
        const sessions = await Promise.all(
          [first, second].map(async (sessionId) => (await Agent.call(deeAgent.aws, "GetSession", { eventId, sessionId })).session),
        );
        // What a model hands on after reading AWS's JSON into its own notes.
        const remade = [
          { ...sessions[0], venue: null, sessionTime: { ...sessions[0].sessionTime, length: Number(sessions[0].sessionTime.length) } },
          { ...sessions[1], sessionTime: { ...sessions[1].sessionTime, time: "4:00 PM" } },
        ];
        const result = await deeAgent.tool("sync_my_schedule", { eventId, sessions: remade, favorites: [first, second], reserved: [] });
        expect(result).toMatchObject({ added: 2, unreadableTimes: [{ sessionId: second, time: "4:00 PM" }] });
      } finally {
        await deeAgent.close();
      }
    });

    it("an agent with no token is told how to get one", async () => {
      const anonymous = new Client({ name: "no-token-agent", version: "0.0.0" });
      await anonymous.connect(new StreamableHTTPClientTransport(new URL(`${hallway}/mcp`)));
      try {
        const result = await anonymous.callTool({ name: "get_my_schedule", arguments: { eventId } });
        expect(result.isError).toBe(true);
        expect(JSON.stringify(result.content)).toContain("Connect your agent");
      } finally {
        await anonymous.close();
      }
    });
  });

  it("no abstract leaves Hallway: not the link preview, the share image or the calendar feed (ADR 0025)", async () => {
    await rest("PUT", "/api/me/visibility", ben.cookie, { visibility: "public" });
    const page = async () => {
      const response = await fetch(`${hallway}/@${ben.handle}`);
      expect(response.status).toBe(200);
      return response.text();
    };
    const card = async (cookie?: string) => {
      const response = await fetch(`${hallway}/og/${ben.handle}.png`, cookie ? { headers: { cookie } } : {});
      expect(response.headers.get("content-type")).toBe("image/png");
      return Buffer.from(await response.arrayBuffer());
    };
    const feed = async () => {
      await rest("POST", "/api/me/calendar-feed/rotate", ben.cookie);
      const { calendarUrl } = await rest<{ calendarUrl: string }>("GET", "/api/me/share", ben.cookie);
      return (await fetch(calendarUrl)).text();
    };

    const before = { page: await page(), anonymous: await card(), owner: await card(ben.cookie) };
    expect(before.page).toContain('property="og:image"');
    expect(before.page).not.toContain("ABSTRACT-TEXT");
    expect(await feed()).not.toContain("ABSTRACT-TEXT");

    // AWS rewrites GAM301's abstract and Ben's agent syncs it. Ben reports
    // it alone, so the catalog's abstract changes, and his other sessions
    // still match Ada's, so he still reads it (issue #83). The share image, drawn
    // by the real renderer with GAM301 on it, must not change by a byte.
    const aws = await connectFakeAwsEvents({
      ...benAws,
      sessions: benAws.sessions.map((session) =>
        session.sessionId === "s-gam301" ? { ...session, abstract: `ABSTRACT-TEXT-CHANGED ${session.sessionId}` } : session,
      ),
    });
    const { schedule } = await Agent.call(aws, "GetSchedule", { eventId });
    const sessions = [];
    for (const sessionId of [...schedule.reserved, ...schedule.favorites]) {
      sessions.push((await Agent.call(aws, "GetSession", { eventId, sessionId })).session);
    }
    await aws.close();
    await benAgent.tool("sync_my_schedule", { eventId, sessions, favorites: schedule.favorites, reserved: schedule.reserved });
    expect((await benAgent.tool("get_session", { eventId, sessionId: "s-gam301" })).abstract).toBe(
      "ABSTRACT-TEXT-CHANGED s-gam301",
    );

    expect((await card()).equals(before.anonymous)).toBe(true);
    expect((await card(ben.cookie)).equals(before.owner)).toBe(true);
    expect(await page()).toBe(before.page);
    expect(await feed()).not.toContain("ABSTRACT-TEXT");
  });

  it("an agent token cannot mint another token", async () => {
    const response = await fetch(`${hallway}/api/me/tokens`, {
      method: "POST",
      headers: { authorization: `Bearer ${await issueAgentToken(ada)}`, "content-type": "application/json" },
      body: JSON.stringify({ label: "escalation" }),
    });
    expect(response.status).toBe(403);
  });
});

// Issue #63: follows (ADR 0019). GitHub is linked through the dev-only
// `/api/dev/github`, which ends the same link path a GitHub round trip does,
// since the suite runs offline. The issue's three cases, each through agents:
//   A. Fay follows Gus on GitHub; Gus is network-only, so Fay cannot see his week.
//   B. Gus follows Fay back, so she can.
//   C. Fay's LinkedIn import matches Hal, so Hal sees Fay's network-only week.
describe("follows from GitHub and LinkedIn let the follower's week be seen, never the followed one's", () => {
  let fay: Person;
  let gus: Person;
  let hal: Person;
  let fayAgent: Agent;
  let gusAgent: Agent;
  let halAgent: Agent;
  const linkGitHub = (person: Person, id: number, following: number[]) =>
    rest("POST", "/api/dev/github", person.cookie, {
      id,
      login: person.handle,
      following: following.map((followed) => ({ id: followed, login: `user${followed}` })),
    });

  beforeAll(async () => {
    [fay, gus, hal] = [await signIn("Fay Wong"), await signIn("Gus Moreno"), await signIn("Hal Novak")];
    fayAgent = await Agent.start("fay", await issueAgentToken(fay), adaAws);
    gusAgent = await Agent.start("gus", await issueAgentToken(gus), benAws);
    halAgent = await Agent.start("hal", await issueAgentToken(hal), benAws);
    for (const agent of [fayAgent, gusAgent, halAgent]) await agent.syncFromAws();
  });

  afterAll(async () => {
    await Promise.all([fayAgent?.close(), gusAgent?.close(), halAgent?.close()]);
  });

  it("everyone starts on My network visibility", async () => {
    expect((await fayAgent.tool("whoami")).visibility).toBe("network");
  });

  it("A: Fay follows Gus on GitHub and still cannot see his network-only week", async () => {
    await linkGitHub(gus, 7001, []);
    await linkGitHub(fay, 7002, [7001, 9999]);

    await expect(fayAgent.tool("get_person_schedule", { handle: gus.handle, eventId })).rejects.toThrow(
      /Following them does not change that/,
    );
    const listed = await fayAgent.tool("list_my_network", { eventId });
    expect(listed.people.map((p: Structured) => [p.person.handle, p.how, p.scheduleVisible, p.sessions])).toEqual([
      [gus.handle, ["github"], false, 0],
    ]);
    const going = await fayAgent.tool("who_is_going", { eventId, sessionIds: ["s-aim3315"] });
    expect(going.sessions[0].people).toEqual([]);
    const following = await rest<Structured>("GET", "/api/me/following", fay.cookie);
    expect(following.github).toMatchObject({ linked: true, notOnHallway: 1 });

    // Fay following Gus is her consent: his agent can see her week.
    const hers = await gusAgent.tool("get_person_schedule", { handle: fay.handle, eventId });
    expect(hers.entries.length).toBe(15);
  });

  it("B: Gus follows Fay back, and her agent plans around him", async () => {
    await linkGitHub(gus, 7001, [7002]);

    const his = await fayAgent.tool("get_person_schedule", { handle: gus.handle, eventId });
    expect(his.entries.map((e: Structured) => e.session.code)).toContain("AIM3315");
    const going = await fayAgent.tool("who_is_going", { eventId, sessionIds: ["s-aim3315"] });
    expect(names(going.sessions[0].people)).toEqual([gus.name]);
    const agenda = await fayAgent.tool("network_agenda", { eventId, day: tuesday, from: "08:00", to: "10:00" });
    expect(agenda.items.flatMap((item: Structured) => names(item.people))).toContain(gus.name);
    const gaps = await fayAgent.tool("find_meeting_gaps", { eventId, handle: gus.handle, day: tuesday });
    expect(gaps.with.handle).toBe(gus.handle);
    const listed = await fayAgent.tool("list_my_network", { eventId });
    expect(listed.people[0]).toMatchObject({ how: ["github"], scheduleVisible: true, sessions: 7 });
  });

  it("C: Fay's LinkedIn import matches Hal, so Hal sees Fay's week and Fay still does not see Hal's", async () => {
    await rest("PATCH", "/api/me", hal.cookie, { linkedinProfileUrl: "https://www.linkedin.com/in/hal-novak" });
    await expect(halAgent.tool("get_person_schedule", { handle: fay.handle, eventId })).rejects.toThrow(/forbidden/);

    const csv = ["First Name,Last Name,URL,Email Address,Company,Position,Connected On", "Hal,Novak,https://www.linkedin.com/in/hal-novak,,,,"];
    const uploaded = await fetch(`${hallway}/api/me/contacts`, {
      method: "POST",
      headers: { cookie: fay.cookie, "content-type": "text/csv" },
      body: csv.join("\n"),
    });
    expect(uploaded.status).toBe(200);

    expect((await halAgent.tool("get_person_schedule", { handle: fay.handle, eventId })).entries.length).toBe(15);
    await expect(fayAgent.tool("get_person_schedule", { handle: hal.handle, eventId })).rejects.toThrow(/forbidden/);
    const following = await rest<Structured>("GET", "/api/me/following", fay.cookie);
    expect(following.linkedinImport.people.map((p: Structured) => [p.person.handle, p.scheduleVisible])).toEqual([
      [hal.handle, false],
    ]);
  });
});
