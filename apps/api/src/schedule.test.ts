// The schedule slice through both interfaces, over the in-memory fakes: an
// agent syncing over MCP with a realistic AWS payload, the web app reading
// and editing over REST, and the two agreeing.
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import type { MySchedule, SyncResult } from "@hallway/contracts";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createApp } from "./app.ts";
import { syncMyScheduleDescription } from "./mcp/schedule-tools.ts";
import { inMemoryHandlers, noPng } from "./testing/in-memory-handlers.ts";

interface Fixture {
  schedule: { reserved: string[]; favorites: string[] };
  sessions: { sessionId: string; abstract?: string; [field: string]: unknown }[];
}
const fixture = JSON.parse(
  readFileSync(new URL("./schedule-fixtures/aws-reinvent2026-schedule.json", import.meta.url), "utf8"),
) as Fixture;
const syncInput = (
  overrides: Partial<{ sessions: unknown[]; favorites: string[]; reserved: string[]; invitedSessions: unknown[] }> = {},
) => ({
  eventId: "reinvent2026",
  sessions: fixture.sessions,
  favorites: fixture.schedule.favorites,
  reserved: fixture.schedule.reserved,
  ...overrides,
});

const bindings = { DEV_SIGN_IN: "1" };
const origin = "http://127.0.0.1:8787";
let call: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
let clock: Date;

beforeEach(() => {
  clock = new Date("2026-11-13T12:00:00.000Z");
  const { handlers } = inMemoryHandlers({ now: () => clock });
  const app = createApp<typeof bindings>({ handlers: () => handlers, renderPng: noPng });
  // Handlers are built per request; the fake store under them lives for the test.
  call = async (input, init) => app.fetch(new Request(input, init), bindings);
});

const as = (attendeeId: string) => ({ authorization: `Bearer dev:${attendeeId}` });

async function mcpAs(attendeeId: string) {
  const client = new Client({ name: "schedule-test", version: "0.0.0" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL("/mcp", origin), {
      fetch: call,
      requestInit: { headers: as(attendeeId) },
    }),
  );
  return client;
}

async function syncOverMcp(attendeeId: string, args: Record<string, unknown>) {
  const client = await mcpAs(attendeeId);
  const result = await client.callTool({ name: "sync_my_schedule", arguments: args });
  await client.close();
  return result;
}

const rest = async (path: string, attendeeId?: string, init: RequestInit = {}) => {
  const headers = { "content-type": "application/json", ...(attendeeId ? as(attendeeId) : {}) };
  return call(`${origin}${path}`, { ...init, headers });
};
const mySchedule = async (attendeeId: string) =>
  (await (await rest("/api/events/reinvent2026/my-schedule", attendeeId)).json()) as MySchedule;

describe("sync_my_schedule over MCP", () => {
  it("adds every favorite and reservation, reserved winning when a session is in both", async () => {
    const result = await syncOverMcp("ana", syncInput());
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({
      added: 15,
      removed: 0,
      changed: 0,
      unchanged: 0,
      sessionsStored: 15,
      missingSessions: [],
    } satisfies SyncResult);
    const schedule = await mySchedule("ana");
    expect(schedule.timezone).toBe("America/Los_Angeles");
    expect(schedule.entries).toHaveLength(15);
    expect(schedule.entries.find((e) => e.sessionId === "s-aim3315")).toMatchObject({
      intent: "reserved",
      source: "agent-sync",
      hidden: false,
    });
  });

  it("places sessions in UTC from Las Vegas time, the 23:30 one and the all-day one included", async () => {
    await syncOverMcp("ana", syncInput());
    const sessions = Object.fromEntries((await mySchedule("ana")).entries.map((e) => [e.sessionId, e.session]));
    expect(sessions["s-net201"]).toMatchObject({
      startsAt: "2026-12-03T07:30:00.000Z",
      endsAt: "2026-12-03T08:30:00.000Z",
    });
    expect(sessions["s-expo-tue"]).toMatchObject({
      isAllDay: true,
      startsAt: "2026-12-01T08:00:00.000Z",
      endsAt: "2026-12-02T08:00:00.000Z",
    });
    expect(sessions["s-aim3315"]).toMatchObject({
      code: "AIM3315",
      url: "https://example.test/catalog?search=AIM3315",
      speakers: ["Priya Raman", "Tom Okafor"],
    });
  });

  it("is idempotent: the same input twice is all unchanged the second time", async () => {
    await syncOverMcp("ana", syncInput());
    const again = await syncOverMcp("ana", syncInput());
    expect(again.structuredContent).toMatchObject({ added: 0, removed: 0, changed: 0, unchanged: 15 });
    expect((await mySchedule("ana")).entries).toHaveLength(15);
  });

  it("removes an un-favorited session and promotes a newly reserved one", async () => {
    await syncOverMcp("ana", syncInput());
    const favorites = fixture.schedule.favorites.filter((id) => id !== "s-dev318");
    const second = await syncOverMcp("ana", syncInput({ favorites, reserved: [...fixture.schedule.reserved, "s-svs401"] }));
    expect(second.structuredContent).toMatchObject({ added: 0, removed: 1, changed: 1, unchanged: 13 });
    const entries = (await mySchedule("ana")).entries;
    expect(entries.map((e) => e.sessionId)).not.toContain("s-dev318");
    expect(entries.find((e) => e.sessionId === "s-svs401")?.intent).toBe("reserved");
  });

  it("records the last sync, read back the same over REST and get_my_schedule", async () => {
    expect(await mySchedule("ana")).not.toHaveProperty("lastSync");
    await syncOverMcp("ana", syncInput({ favorites: [...fixture.schedule.favorites, "s-nowhere"] }));
    const first = { syncedAt: "2026-11-13T12:00:00.000Z", added: 15, removed: 0, changed: 0, unchanged: 0, missingSessions: 1 };
    expect((await mySchedule("ana")).lastSync).toEqual(first);

    clock = new Date("2026-11-13T12:12:00.000Z");
    const favorites = fixture.schedule.favorites.filter((id) => id !== "s-dev318");
    await syncOverMcp("ana", syncInput({ favorites, reserved: [...fixture.schedule.reserved, "s-svs401"] }));
    const second = { syncedAt: "2026-11-13T12:12:00.000Z", added: 0, removed: 1, changed: 1, unchanged: 13, missingSessions: 0 };
    expect((await mySchedule("ana")).lastSync).toEqual(second);

    const client = await mcpAs("ana");
    const overMcp = await client.callTool({ name: "get_my_schedule", arguments: { eventId: "reinvent2026" } });
    await client.close();
    expect((overMcp.structuredContent as MySchedule).lastSync).toEqual(second);
    expect(await mySchedule("bo")).not.toHaveProperty("lastSync");
  });

  it("keeps an id without a snapshot when the catalog has it, and reports it when not", async () => {
    await syncOverMcp("ana", syncInput());
    const result = await syncOverMcp("ben", {
      eventId: "reinvent2026",
      sessions: [],
      favorites: ["s-aim3315", "s-never-seen"],
      reserved: [],
    });
    expect(result.structuredContent).toMatchObject({ added: 1, missingSessions: ["s-never-seen"] });
    expect((await mySchedule("ben")).entries.map((e) => e.sessionId)).toEqual(["s-aim3315"]);
  });

  it("merges an attendee's snapshots forward: their later, thinner snapshot keeps the fields it lacks", async () => {
    await syncOverMcp("ana", syncInput());
    clock = new Date("2026-11-13T12:12:00.000Z");
    await syncOverMcp("ana", syncInput({
      sessions: [{ sessionId: "s-aim3315", title: "Building agents that call MCP servers, at scale" }],
    }));
    const session = (await (await rest("/api/events/reinvent2026/sessions/s-aim3315")).json()) as Record<string, unknown>;
    expect(session).toMatchObject({
      title: "Building agents that call MCP servers, at scale",
      room: "Room 118",
      startsAt: "2026-12-01T16:30:00.000Z",
      lastSeenAt: "2026-11-13T12:12:00.000Z",
    });
  });

  it("ignores a snapshot of a session not on the sender's own schedule (hunt F6)", async () => {
    await syncOverMcp("ana", syncInput());
    const poisoned = { sessionId: "s-aim3315", title: "CANCELLED, see you at the bar", sessionTime: { date: "2026-12-04", time: "06:00", length: "5" } };
    const result = await syncOverMcp("cy", { eventId: "reinvent2026", sessions: [poisoned], favorites: [], reserved: [] });
    expect(result.structuredContent).toMatchObject({ sessionsStored: 0 });
    expect((await mySchedule("ana")).entries.find((e) => e.sessionId === "s-aim3315")?.session).toMatchObject({
      title: "Building agents that call MCP servers at scale",
      startsAt: "2026-12-01T16:30:00.000Z",
    });
  });

  it("shows what most reporters agree on: one newer report does not override two", async () => {
    await syncOverMcp("ana", syncInput());
    clock = new Date("2026-11-13T12:05:00.000Z");
    await syncOverMcp("ben", syncInput());
    clock = new Date("2026-11-13T12:10:00.000Z");
    const poisoned = { sessionId: "s-aim3315", title: "CANCELLED, see you at the bar", sessionTime: { date: "2026-12-04", time: "06:00", length: "5" } };
    await syncOverMcp("cy", { eventId: "reinvent2026", sessions: [poisoned], favorites: ["s-aim3315"], reserved: [] });
    const session = (await (await rest("/api/events/reinvent2026/sessions/s-aim3315")).json()) as Record<string, unknown>;
    expect(session).toMatchObject({
      title: "Building agents that call MCP servers at scale",
      startsAt: "2026-12-01T16:30:00.000Z",
      lastSeenAt: "2026-11-13T12:10:00.000Z",
    });
  });

  it("puts AWS invitedSessions on the schedule as reserved and invited (hunt F8)", async () => {
    const keynote = { sessionId: "s-inv1", title: "Invited keynote", abbreviation: "KEY001", sessionTime: { date: "2026-12-02", time: "08:00", length: "90" } };
    const result = await syncOverMcp("ana", syncInput({ invitedSessions: [keynote] }));
    expect(result.structuredContent).toMatchObject({ added: 16, sessionsStored: 16 });
    expect((await mySchedule("ana")).entries.find((e) => e.sessionId === "s-inv1")).toMatchObject({
      intent: "reserved",
      source: "agent-sync",
      invited: true,
      session: { title: "Invited keynote", startsAt: "2026-12-02T16:00:00.000Z" },
    });
    const again = await syncOverMcp("ana", syncInput());
    expect(again.structuredContent).toMatchObject({ removed: 1 });
  });

  it("lowers a manual entry back to interested once AWS stops saying it is reserved (hunt F7)", async () => {
    await syncOverMcp("ana", syncInput());
    await rest("/api/events/reinvent2026/my-schedule/entries/s-aim3315", "cy", { method: "POST" });
    const intent = async () => (await mySchedule("cy")).entries.find((e) => e.sessionId === "s-aim3315")?.intent;
    const sync = (reserved: string[]) =>
      syncOverMcp("cy", { eventId: "reinvent2026", sessions: [], favorites: [], reserved });
    expect(await sync(["s-aim3315"]).then((r) => r.structuredContent)).toMatchObject({ changed: 1 });
    expect(await intent()).toBe("reserved");
    expect(await sync([]).then((r) => r.structuredContent)).toMatchObject({ changed: 1, removed: 0 });
    expect(await intent()).toBe("interested");
    expect((await mySchedule("cy")).entries.find((e) => e.sessionId === "s-aim3315")?.source).toBe("manual");
  });

  it("keeps a hidden session hidden when it leaves a sync and comes back (hunt F5)", async () => {
    await syncOverMcp("ana", syncInput());
    const hide = await rest("/api/events/reinvent2026/my-schedule/entries/s-aim3315", "ana", {
      method: "PATCH",
      body: JSON.stringify({ hidden: true }),
    });
    expect(hide.status).toBe(200);
    await syncOverMcp("ana", syncInput({
      reserved: fixture.schedule.reserved.filter((id) => id !== "s-aim3315"),
      favorites: fixture.schedule.favorites.filter((id) => id !== "s-aim3315"),
    }));
    expect((await mySchedule("ana")).entries.map((e) => e.sessionId)).not.toContain("s-aim3315");
    await syncOverMcp("ana", syncInput());
    expect((await mySchedule("ana")).entries.find((e) => e.sessionId === "s-aim3315")?.hidden).toBe(true);
  });

  it("accepts sessions without abstracts, as ListSessions with includeAbstracts=false gives them", async () => {
    const sessions = fixture.sessions.map(({ abstract: _abstract, ...rest }) => rest);
    const result = await syncOverMcp("ana", syncInput({ sessions }));
    expect(result.structuredContent).toMatchObject({ added: 15 });
  });

  it("never stores or serves an abstract", async () => {
    await syncOverMcp("ana", syncInput());
    const bodies = [
      await (await rest("/api/events/reinvent2026/my-schedule", "ana")).text(),
      await (await rest("/api/events/reinvent2026/sessions?limit=200")).text(),
      await (await rest("/api/events/reinvent2026/sessions/s-aim3315")).text(),
    ];
    const client = await mcpAs("ana");
    for (const [name, args] of [
      ["get_my_schedule", { eventId: "reinvent2026" }],
      ["search_sessions", { eventId: "reinvent2026", limit: 200 }],
    ] as const) {
      bodies.push(JSON.stringify(await client.callTool({ name, arguments: args })));
    }
    await client.close();
    for (const body of bodies) {
      expect(body).toContain("AIM3315");
      expect(body).not.toContain("ABSTRACT-TEXT");
      expect(body).not.toContain('"abstract"');
    }
  });

  it("refuses an anonymous caller and an unknown event", async () => {
    const client = new Client({ name: "anonymous", version: "0.0.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL("/mcp", origin), { fetch: call }));
    const anonymous = await client.callTool({ name: "sync_my_schedule", arguments: syncInput() });
    await client.close();
    expect(anonymous.isError).toBe(true);
    expect(JSON.stringify(anonymous.content)).toContain("unauthenticated");

    const unknown = await syncOverMcp("ana", { ...syncInput(), eventId: "summit-nowhere" });
    expect(unknown.isError).toBe(true);
    expect(JSON.stringify(unknown.content)).toContain("not-found");
  });

  it("tells the agent where the input comes from, and that Hallway never reserves", async () => {
    const client = await mcpAs("ana");
    const tool = (await client.listTools()).tools.find((t) => t.name === "sync_my_schedule");
    await client.close();
    expect(tool?.description).toBe(syncMyScheduleDescription);
    for (const phrase of ["GetSchedule", "GetSession", "reinvent2026", "includeAbstracts=false", "never reserves"]) {
      expect(syncMyScheduleDescription).toContain(phrase);
    }
  });

  it("lists the slice's tools", async () => {
    const client = await mcpAs("ana");
    const names = (await client.listTools()).tools.map((t) => t.name);
    await client.close();
    expect(names).toEqual(
      expect.arrayContaining(["sync_my_schedule", "get_my_schedule", "search_sessions", "add_to_plan", "remove_from_plan"]),
    );
  });
});

describe("my schedule over REST", () => {
  it("PUT syncs the same way the tool does", async () => {
    const { eventId: _eventId, ...body } = syncInput();
    const response = await rest("/api/events/reinvent2026/my-schedule", "ana", {
      method: "PUT",
      body: JSON.stringify(body),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ added: 15 });
  });

  it("GET answers 401 without sign-in", async () => {
    const response = await rest("/api/events/reinvent2026/my-schedule");
    expect(response.status).toBe(401);
  });

  it("a manual entry survives syncs, is raised to reserved by one, and can be hidden and removed", async () => {
    await syncOverMcp("ana", syncInput());
    // ben adds by hand a session ana's agent put in the catalog.
    const added = await rest("/api/events/reinvent2026/my-schedule/entries/s-cmp310", "ben", { method: "POST" });
    expect(added.status).toBe(200);
    expect(await added.json()).toMatchObject({ intent: "interested", source: "manual" });

    await syncOverMcp("ben", { eventId: "reinvent2026", sessions: [], favorites: [], reserved: [] });
    expect((await mySchedule("ben")).entries.map((e) => e.sessionId)).toEqual(["s-cmp310"]);

    await syncOverMcp("ben", { eventId: "reinvent2026", sessions: [], favorites: [], reserved: ["s-cmp310"] });
    expect((await mySchedule("ben")).entries[0]).toMatchObject({ intent: "reserved", source: "manual" });

    const hidden = await rest("/api/events/reinvent2026/my-schedule/entries/s-cmp310", "ben", {
      method: "PATCH",
      body: JSON.stringify({ hidden: true }),
    });
    expect(await hidden.json()).toMatchObject({ hidden: true });
    expect((await mySchedule("ben")).entries[0]?.hidden).toBe(true);

    const removed = await rest("/api/events/reinvent2026/my-schedule/entries/s-cmp310", "ben", { method: "DELETE" });
    expect(removed.status).toBe(200);
    expect((await mySchedule("ben")).entries).toEqual([]);
  });

  it("a hidden synced entry stays hidden through the next sync", async () => {
    await syncOverMcp("ana", syncInput());
    await rest("/api/events/reinvent2026/my-schedule/entries/s-dat302", "ana", {
      method: "PATCH",
      body: JSON.stringify({ hidden: true }),
    });
    await syncOverMcp("ana", syncInput({ reserved: [...fixture.schedule.reserved, "s-dat302"] }));
    expect((await mySchedule("ana")).entries.find((e) => e.sessionId === "s-dat302")).toMatchObject({
      hidden: true,
      intent: "reserved",
    });
  });

  it("refuses to remove a synced entry (409) and to add a session not in the catalog (404)", async () => {
    await syncOverMcp("ana", syncInput());
    const synced = await rest("/api/events/reinvent2026/my-schedule/entries/s-dat302", "ana", { method: "DELETE" });
    expect(synced.status).toBe(409);
    const unknown = await rest("/api/events/reinvent2026/my-schedule/entries/s-nope", "ana", { method: "POST" });
    expect(unknown.status).toBe(404);
  });
});

describe("the session catalog over REST", () => {
  it("searches by text and by Las Vegas day, in start order", async () => {
    await syncOverMcp("ana", syncInput());
    const codes = async (query: string) =>
      ((await (await rest(`/api/events/reinvent2026/sessions?${query}`)).json()) as { sessions: { code?: string }[] })
        .sessions.map((s) => s.code);
    expect(await codes("q=priya")).toEqual(["AIM3315"]);
    // 23:30 on Wednesday is Thursday in UTC, and still Wednesday here.
    expect(await codes("day=2026-12-02")).toEqual(["KEY002", "CMP310", "ARC402", "NET201"]);
    expect(await codes("day=2026-12-01&limit=2")).toEqual(["EXP100", "AIM3315"]);
  });

  it("answers 400 for a day that does not exist and 404 for an unknown session", async () => {
    expect((await rest("/api/events/reinvent2026/sessions?day=2026-02-30")).status).toBe(400);
    expect((await rest("/api/events/reinvent2026/sessions/s-nope")).status).toBe(404);
  });
});
