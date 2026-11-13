// Issue #22: the agent journey, end to end, against the real Worker.
//
// Two people sign in on the web (dev sign-in) and each issues an agent token.
// Each scripted agent then does what a real one does: reads its attendee's
// schedule from the AWS Events MCP server (a fake, fake-aws-events-mcp.ts),
// and pushes it to Hallway's /mcp with `sync_my_schedule`, carrying the agent
// token. Ben hides one session on the web, Ada connects through Ben's share
// link, and Ada's agent plans around Ben: who is going, the network agenda,
// a time to meet. Ben's hidden session must never reach Ada, on any path.
// Session abstracts reach an agent only once its own attendee has synced, and
// never a signed-out caller, a link preview, the share image or the calendar
// feed (ADR 0025).
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

    // Ada's agent has synced: it reads abstracts. Ben's has not yet, and a
    // signed-out caller never does.
    const aim = { eventId, sessionId: "s-aim3315" };
    expect((await adaAgent.tool("get_session", aim)).abstract).toMatch(/^ABSTRACT-TEXT-AIM3315/);
    const found = await adaAgent.tool("search_sessions", { eventId, q: "AIM3315" });
    expect(found.sessions[0].abstract).toMatch(/^ABSTRACT-TEXT-AIM3315/);
    expect(await benAgent.tool("get_session", aim)).not.toHaveProperty("abstract");
    expect(JSON.stringify(await benAgent.tool("search_sessions", { eventId, limit: 200 }))).not.toContain("ABSTRACT-TEXT");
    for (const path of [`/api/events/${eventId}/sessions/s-aim3315`, `/api/events/${eventId}/sessions?limit=200`]) {
      const signedOut = await fetch(`${hallway}${path}`);
      expect(signedOut.status).toBe(200);
      expect(await signedOut.text()).not.toContain("ABSTRACT-TEXT");
    }

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
    expect((await benAgent.tool("get_session", aim)).abstract).toMatch(/^ABSTRACT-TEXT-AIM3315/);
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

    expect(names((await adaAgent.tool("list_my_connections")).connections.map((c: Structured) => c.person))).toEqual([
      ben.name,
    ]);
    expect(names((await benAgent.tool("list_my_connections")).connections.map((c: Structured) => c.person))).toEqual([
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

  it("list_my_connections counts Ben's sessions Ada may see, and those she shares, without the hidden one", async () => {
    // Ben has seven; CNT320 is hidden, so six. Of those Ada also plans AIM3315, SVS401, DAT302
    // and the Tuesday keynote.
    const listed = await adaAgent.tool("list_my_connections", { eventId });
    expect(listed.connections).toEqual([
      expect.objectContaining({ person: expect.objectContaining({ handle: ben.handle }), sessions: 6, sharedWithMe: 4 }),
    ]);
    const plain = await adaAgent.tool("list_my_connections");
    expect(plain.connections[0]).not.toHaveProperty("sessions");
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

    // Ben's agent sends every abstract changed. GAM301 is reported by Ben
    // alone, so its abstract in the catalog changes; the share image, drawn
    // by the real renderer with GAM301 on it, must not change by a byte.
    const aws = await connectFakeAwsEvents({
      ...benAws,
      sessions: benAws.sessions.map((session) => ({ ...session, abstract: `ABSTRACT-TEXT-CHANGED ${session.sessionId}` })),
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
