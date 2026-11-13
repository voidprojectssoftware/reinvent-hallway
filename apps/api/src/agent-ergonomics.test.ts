// Issues #54 and #68: what an agent is told when something goes wrong, held to
// "it can act on it with its own tools". Each case is a finding of the agent
// journey hunt (docs/discovery/hunts/2026-11-13-agent-journey.md), over MCP
// as an agent meets it, and over REST where the two share a mapping.
import { beforeEach, describe, expect, it } from "vitest";
import type { Handlers } from "./app.ts";
import type { Me } from "@hallway/contracts";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createApp } from "./app.ts";
import { inMemoryHandlers, noPng } from "./testing/in-memory-handlers.ts";

const bindings = { DEV_SIGN_IN: "1" };
const origin = "http://127.0.0.1:8787";
const eventId = "reinvent2026";
let handlers: Handlers;
let call: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

beforeEach(() => {
  handlers = inMemoryHandlers({ now: () => new Date("2026-11-13T12:00:00.000Z") }).handlers;
  const app = createApp<typeof bindings>({ handlers: () => handlers, renderPng: noPng });
  call = async (input, init) => app.fetch(new Request(input, init), bindings);
});

async function rest(path: string, as?: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  if (!headers.has("content-type")) headers.set("content-type", "application/json");
  if (as) headers.set("authorization", `Bearer dev:${as}`);
  return call(`${origin}${path}`, { ...init, headers });
}
const post = (body: unknown, method = "POST"): RequestInit => ({ method, body: JSON.stringify(body) });

async function signIn(name: string, visibility?: Me["visibility"]): Promise<Me> {
  const me = (await (await rest("/api/dev/sign-in", undefined, post({ name }))).json()) as Me;
  if (visibility) await rest("/api/me/visibility", me.id, post({ visibility }, "PUT"));
  return me;
}

async function connect(viewer: Me, owner: Me) {
  const invite = (await (await rest("/api/me/invite", owner.id)).json()) as { token: string };
  expect((await rest(`/api/attendees/${owner.handle}/connect`, viewer.id, post({ invite: invite.token }))).status).toBe(200);
}

type Answer = { value: Record<string, any>; error?: undefined } | { value?: undefined; error: { kind: string; message: string } };

async function tool(as: string | undefined, name: string, args: Record<string, unknown> = {}): Promise<Answer> {
  const client = new Client({ name: "ergonomics-test", version: "0.0.0" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL("/mcp", origin), {
      fetch: call,
      requestInit: as ? { headers: { authorization: `Bearer dev:${as}` } } : {},
    }),
  );
  const result = await client.callTool({ name, arguments: args });
  await client.close();
  const text = (result.content as { text: string }[])[0]!.text;
  return result.isError ? { error: JSON.parse(text) } : { value: result.structuredContent as Record<string, any> };
}

const session = (sessionId: string, sessionTime: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  sessionId,
  abbreviation: sessionId.toUpperCase(),
  title: `Session ${sessionId}`,
  sessionTime: { date: "2026-12-01", ...sessionTime },
  ...extra,
});
const sync = (as: string, sessions: unknown[], favorites: string[]) =>
  tool(as, "sync_my_schedule", { eventId, sessions, favorites, reserved: [] });

describe("an unexpected failure (#68)", () => {
  const driverText = "D1_ERROR: UNIQUE constraint failed: plan_entries.attendee_id: SQLITE_CONSTRAINT";

  it("reaches an agent as a generic error it can retry, with no driver text", async () => {
    handlers.searchSessions = async () => {
      throw new Error(driverText);
    };
    const answer = await tool("ana", "search_sessions", { eventId, q: "x" });
    expect(answer.error).toEqual({ kind: "unavailable", message: expect.stringContaining("Try the same call again") });
    expect(JSON.stringify(answer)).not.toMatch(/D1_ERROR|plan_entries|SQLITE/);
  });

  it("reaches a REST caller as 503 with the same Error resource", async () => {
    handlers.searchSessions = async () => {
      throw new Error(driverText);
    };
    const response = await rest(`/api/events/${eventId}/sessions?q=x`);
    expect(response.status).toBe(503);
    const body = await response.text();
    expect(JSON.parse(body)).toMatchObject({ kind: "unavailable" });
    expect(body).not.toMatch(/D1_ERROR|plan_entries|SQLITE/);
  });

  it("is caught even when a handler throws before returning a promise", async () => {
    handlers.getMySchedule = () => {
      throw new Error(driverText);
    };
    expect((await tool("ana", "get_my_schedule", { eventId })).error?.kind).toBe("unavailable");
  });
});

describe("sync input as models send it", () => {
  it("lists times it cannot read instead of reporting them placed (F2)", async () => {
    const answer = await sync(
      "ana",
      [
        session("s-12h", { time: "4:00 PM", length: "60" }),
        session("s-date", { date: "2026-12-1", time: "10:00", length: "60" }),
        session("s-len", { time: "10:00", length: "an hour" }),
        session("s-ok", { time: "16:00:00", length: "60" }),
        session("s-expo", { time: "whenever" }, { isAllDaySession: true }),
      ],
      ["s-12h", "s-date", "s-len", "s-ok", "s-expo"],
    );
    expect(answer.value?.unreadableTimes).toEqual([
      { sessionId: "s-12h", time: "4:00 PM" },
      { sessionId: "s-date", date: "2026-12-1" },
      { sessionId: "s-len", length: "an hour" },
    ]);
    const mine = (await tool("ana", "get_my_schedule", { eventId })).value!;
    const startsAt = Object.fromEntries(mine.entries.map((e: any) => [e.sessionId, e.session.startsAt]));
    expect(startsAt["s-12h"]).toBeUndefined();
    expect(startsAt["s-ok"]).toBe("2026-12-02T00:00:00.000Z");
  });

  it("reads a numeric length and null fields, and still refuses a wrong type with its path (F11)", async () => {
    const answer = await sync(
      "ana",
      [session("s-num", { time: "10:00", length: 45, timezone: null }, { venue: null, abstract: null, speakers: [{ name: null }] })],
      ["s-num"],
    );
    expect(answer.value).toMatchObject({ added: 1, unreadableTimes: [] });
    const entry = (await tool("ana", "get_my_schedule", { eventId })).value!.entries[0];
    expect(entry.session).toMatchObject({ startsAt: "2026-12-01T18:00:00.000Z", endsAt: "2026-12-01T18:45:00.000Z" });
    expect(entry.session).not.toHaveProperty("venue");

    const client = new Client({ name: "ergonomics-test", version: "0.0.0" });
    await client.connect(
      new StreamableHTTPClientTransport(new URL("/mcp", origin), {
        fetch: call,
        requestInit: { headers: { authorization: "Bearer dev:ana" } },
      }),
    );
    const refused = await client.callTool({
      name: "sync_my_schedule",
      arguments: { eventId, sessions: [session("s-bad", { length: true })], favorites: ["s-bad"], reserved: [] },
    });
    await client.close();
    expect(refused.isError).toBe(true);
    expect(JSON.stringify(refused.content)).toContain("sessions[0].sessionTime.length");
  });
});

describe("planning reads an agent can trust", () => {
  let ana: Me;
  let ben: Me;

  beforeEach(async () => {
    [ana, ben] = [await signIn("Ana Silva"), await signIn("Ben Ode")];
    await connect(ana, ben);
    await sync(
      ben.id,
      [
        session("s-talk", { time: "09:00", length: "60" }),
        session("s-nolen", { time: "11:00" }),
        session("s-secret", { time: "14:00" }),
      ],
      ["s-talk", "s-nolen", "s-secret"],
    );
    await tool(ben.id, "set_entry_hidden", { eventId, sessionId: "s-secret", hidden: true });
  });

  it("names the sessions with no length that do not block a gap, and only those the asker may see (F3)", async () => {
    const answer = await tool(ana.id, "find_meeting_gaps", { eventId, handle: ben.handle, day: "2026-12-01" });
    expect(answer.value?.gaps.map((g: any) => `${g.start}-${g.end}`)).toEqual(["08:00-09:00", "10:00-18:00"]);
    expect(answer.value?.unplacedSessions).toEqual([
      expect.objectContaining({ whose: "theirs", sessionId: "s-nolen", code: "S-NOLEN", start: "11:00" }),
    ]);
  });

  it("refuses a day outside the event, naming its dates (F9)", async () => {
    for (const [name, args] of [
      ["find_meeting_gaps", { eventId, handle: ben.handle, day: "2025-12-02" }],
      ["network_agenda", { eventId, day: "2026-12-31" }],
    ] as const) {
      const answer = await tool(ana.id, name, args);
      expect(answer.error, name).toEqual({ kind: "invalid", message: expect.stringContaining("2026-11-30 to 2026-12-04") });
    }
  });

  it("reads 24:00 as the end of the day in both windows (F13)", async () => {
    const gaps = await tool(ana.id, "find_meeting_gaps", { eventId, handle: ben.handle, day: "2026-12-01", from: "18:00", to: "24:00" });
    expect(gaps.value?.gaps.map((g: any) => `${g.start}-${g.end}`)).toEqual(["18:00-24:00"]);
    expect((await tool(ana.id, "network_agenda", { eventId, day: "2026-12-01", to: "24:00" })).error).toBeUndefined();
  });

  it("names asked ids the catalog does not have (F13)", async () => {
    const answer = await tool(ana.id, "who_is_going", { eventId, sessionIds: ["s-talk", "S-TALK", "nope"] });
    expect(answer.value?.unknownSessions).toEqual(["S-TALK", "nope"]);
    expect(answer.value?.sessions[0].people.map((p: any) => p.handle)).toEqual([ben.handle]);
    const known = await tool(ana.id, "who_is_going", { eventId, sessionIds: ["s-talk"] });
    expect(known.value).not.toHaveProperty("unknownSessions");
  });

  it("says when a search saw only some of the matches (F12)", async () => {
    const page = await tool(ana.id, "search_sessions", { eventId, q: "session", limit: 2 });
    expect(page.value).toMatchObject({ total: 3, truncated: true });
    expect(page.value?.sessions).toHaveLength(2);
    const all = await tool(ana.id, "search_sessions", { eventId, q: "session" });
    expect(all.value).toMatchObject({ total: 3, truncated: false });
  });
});

describe("refusals that name a next step (F10)", () => {
  it("points a refused remove at set_entry_hidden, which hides the session for good", async () => {
    await sync("ana", [session("s-a", { time: "09:00", length: "60" })], ["s-a"]);
    const refused = await tool("ana", "remove_from_plan", { eventId, sessionId: "s-a" });
    expect(refused.error).toMatchObject({ kind: "conflict", message: expect.stringContaining("set_entry_hidden") });

    const hidden = await tool("ana", "set_entry_hidden", { eventId, sessionId: "s-a", hidden: true });
    expect(hidden.value).toMatchObject({ sessionId: "s-a", hidden: true });
    // Hiding is #67's set: it outlives the session leaving the sync and coming back.
    await sync("ana", [], []);
    await sync("ana", [session("s-a", { time: "09:00", length: "60" })], ["s-a"]);
    expect((await tool("ana", "get_my_schedule", { eventId })).value!.entries[0]).toMatchObject({ hidden: true });
    expect((await tool("ana", "set_entry_hidden", { eventId, sessionId: "s-a", hidden: false })).value).toMatchObject({
      hidden: false,
    });
  });

  it("takes a session's code where it takes its id, and says where to find an id", async () => {
    await sync("ana", [session("s-a", { time: "09:00", length: "60" }, { abbreviation: "AIM3315" })], ["s-a"]);
    expect((await tool("ben", "add_to_plan", { eventId, sessionId: "aim3315" })).value).toMatchObject({
      sessionId: "s-a",
      source: "manual",
    });
    expect((await tool("ben", "set_entry_hidden", { eventId, sessionId: "AIM3315", hidden: true })).value).toMatchObject({
      sessionId: "s-a",
      hidden: true,
    });
    const unknown = await tool("ben", "add_to_plan", { eventId, sessionId: "XYZ999" });
    expect(unknown.error).toMatchObject({ kind: "not-found", message: expect.stringContaining("search_sessions") });
  });

  it("says why a schedule is not visible: private, or connections only", async () => {
    const [ana, carol, dave] = [await signIn("Ana Silva"), await signIn("Carol Ng", "private"), await signIn("Dave Ito")];
    await connect(ana, carol);
    const privateOne = await tool(ana.id, "get_person_schedule", { eventId, handle: carol.handle });
    expect(privateOne.error?.message).toMatch(/keeps their schedule private.*connecting does not change that/);
    const notConnected = await tool(ana.id, "get_person_schedule", { eventId, handle: dave.handle });
    expect(notConnected.error?.message).toMatch(/connections only, and you are not connected/);
  });

  it("tells an agent with no token how to get one", async () => {
    const answer = await tool(undefined, "get_my_schedule", { eventId });
    expect(answer.error).toMatchObject({ kind: "unauthenticated", message: expect.stringContaining("Connect your agent") });
    expect(answer.error?.message).toContain("Authorization: Bearer hw_");
  });

  it("answers a refused token with WWW-Authenticate and what to do (F13)", async () => {
    const response = await call(`${origin}/mcp`, {
      method: "POST",
      headers: { authorization: "Bearer hw_unknown", "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "whoami", arguments: {} } }),
    });
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBe('Bearer realm="hallway", error="invalid_token"');
    expect(((await response.json()) as { message: string }).message).toContain("Connect your agent");
  });

  it("answers OAuth discovery with a JSON 404, not the web app (F13)", async () => {
    for (const path of ["/.well-known/oauth-protected-resource", "/.well-known/oauth-authorization-server"]) {
      const response = await call(`${origin}${path}`);
      expect(response.status, path).toBe(404);
      expect(response.headers.get("content-type")).toContain("application/json");
    }
  });
});
