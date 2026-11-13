// The network slice through both interfaces, over the in-memory fakes:
// requests and share links forming connections, a LinkedIn export turning
// into suggestions, and every read of someone else's schedule, over REST and
// over MCP, held to the one visibility rule.
import { beforeEach, describe, expect, it } from "vitest";
import type {
  AttendeeCard,
  Invite,
  IssuedAgentToken,
  ConnectionList,
  MeetingGaps,
  Me,
  NetworkAgenda,
  NetworkList,
  PersonSchedule,
  RequestList,
  RequestResult,
  Session,
  SessionList,
  ShareLinks,
  SuggestionList,
  WhoIsGoing,
} from "@hallway/contracts";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createApp } from "./app.ts";
import { networkToolDescriptions } from "./mcp/network-tools.ts";
import { inMemoryHandlers, noPng } from "./testing/in-memory-handlers.ts";

const bindings = { DEV_SIGN_IN: "1" };
const origin = "http://127.0.0.1:8787";
let call: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

beforeEach(() => {
  const { handlers } = inMemoryHandlers({ now: () => new Date("2026-11-13T12:00:00.000Z") });
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

async function mcpTool<T>(as: string | undefined, name: string, args: Record<string, unknown> = {}) {
  const client = new Client({ name: "network-test", version: "0.0.0" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL("/mcp", origin), {
      fetch: call,
      requestInit: as ? { headers: { authorization: `Bearer dev:${as}` } } : {},
    }),
  );
  const result = await client.callTool({ name, arguments: args });
  await client.close();
  return result.isError
    ? { error: JSON.parse((result.content as { text: string }[])[0]!.text) as { kind: string } }
    : { value: result.structuredContent as T };
}

/** A session in AWS's shape on Tuesday 1 December, Las Vegas time. */
const aws = (sessionId: string, time: string, length = "60") => ({
  sessionId,
  abbreviation: sessionId.toUpperCase(),
  title: `Session ${sessionId}`,
  sessionTime: { date: "2026-12-01", time, length },
});
const sync = (
  as: string,
  sessions: ReturnType<typeof aws>[],
  favorites = sessions.map((s) => s.sessionId),
  reserved: string[] = [],
) => rest("/api/events/reinvent2026/my-schedule", as, post({ sessions, favorites, reserved }, "PUT"));
const hide = (as: string, sessionId: string) =>
  rest(`/api/events/reinvent2026/my-schedule/entries/${sessionId}`, as, post({ hidden: true }, "PATCH"));

/** Other's share link, as its owner sees it. */
const inviteOf = async (owner: Me) => (await (await rest("/api/me/invite", owner.id)).json()) as Invite;
const connectWith = (viewer: string | undefined, owner: Me, invite?: string, body: object = { invite }) =>
  rest(`/api/attendees/${owner.handle}/connect`, viewer, post(body));

/** One opens the other's share link and connects. */
async function connect(one: Me, other: Me) {
  const response = await connectWith(one.id, other, (await inviteOf(other)).token);
  expect(response.status).toBe(200);
}

describe("connection requests", () => {
  it("forms a connection when the recipient accepts, and lists it on both sides", async () => {
    const [ana, ben] = [await signIn("Ana Silva"), await signIn("Ben Ode")];
    const sent = (await (await rest("/api/me/connection-requests", ana.id, post({ handle: ben.handle }))).json()) as RequestResult;
    expect(sent.request).toMatchObject({ status: "pending", from: { handle: ana.handle }, to: { handle: ben.handle } });
    expect(sent.connection).toBeUndefined();

    const bens = (await (await rest("/api/me/connection-requests", ben.id)).json()) as RequestList;
    expect(bens.incoming.map((r) => r.id)).toEqual([sent.request.id]);
    expect((await rest(`/api/me/connection-requests/${sent.request.id}/accept`, ana.id, { method: "POST" })).status).toBe(403);

    const accepted = (await (
      await rest(`/api/me/connection-requests/${sent.request.id}/accept`, ben.id, { method: "POST" })
    ).json()) as RequestResult;
    expect(accepted.request.status).toBe("accepted");
    expect(accepted.connection).toMatchObject({ person: { handle: ana.handle }, via: "request" });
    for (const [me, other] of [[ana, ben], [ben, ana]] as const) {
      const list = (await (await rest("/api/me/connections", me.id)).json()) as ConnectionList;
      expect(list.connections.map((c) => c.person.handle)).toEqual([other.handle]);
    }
    expect((await rest("/api/me/connection-requests", ana.id, post({ handle: ben.handle }))).status).toBe(409);
  });

  it("turns two requests in opposite directions into one connection, not two", async () => {
    const [ana, ben] = [await signIn("Ana Silva"), await signIn("Ben Ode")];
    await rest("/api/me/connection-requests", ana.id, post({ handle: ben.handle }));
    const crossed = (await (await rest("/api/me/connection-requests", ben.id, post({ handle: ana.handle }))).json()) as RequestResult;
    expect(crossed.connection?.person.handle).toBe(ana.handle);
    expect(((await (await rest("/api/me/connections", ana.id)).json()) as ConnectionList).connections).toHaveLength(1);
    expect((await (await rest("/api/me/connection-requests", ana.id)).json()) as RequestList).toEqual({ incoming: [], outgoing: [] });
  });

  it("lets the sender withdraw, the recipient decline, and refuses asking yourself", async () => {
    const [ana, ben] = [await signIn("Ana Silva"), await signIn("Ben Ode")];
    const first = ((await (await rest("/api/me/connection-requests", ana.id, post({ handle: ben.handle }))).json()) as RequestResult).request;
    expect((await rest(`/api/me/connection-requests/${first.id}`, ben.id, { method: "DELETE" })).status).toBe(403);
    const withdrawn = (await (await rest(`/api/me/connection-requests/${first.id}`, ana.id, { method: "DELETE" })).json()) as RequestResult;
    expect(withdrawn.request.status).toBe("withdrawn");

    const second = ((await (await rest("/api/me/connection-requests", ana.id, post({ handle: ben.handle }))).json()) as RequestResult).request;
    const declined = (await (
      await rest(`/api/me/connection-requests/${second.id}/decline`, ben.id, { method: "POST" })
    ).json()) as RequestResult;
    expect(declined.request.status).toBe("declined");
    expect((await rest(`/api/me/connection-requests/${second.id}/accept`, ben.id, { method: "POST" })).status).toBe(409);
    expect((await rest("/api/me/connection-requests", ana.id, post({ handle: ana.handle }))).status).toBe(400);
  });

  it("connects at once through a share link, idempotently, and either side can remove it", async () => {
    const [ana, ben] = [await signIn("Ana Silva"), await signIn("Ben Ode")];
    await rest("/api/me/connection-requests", ben.id, post({ handle: ana.handle }));
    await connect(ana, ben);
    await connect(ana, ben);
    const list = (await (await rest("/api/me/connections", ben.id)).json()) as ConnectionList;
    expect(list.connections).toMatchObject([{ person: { handle: ana.handle }, via: "share-link" }]);
    // The request Ben had pending is settled by the share link.
    expect(((await (await rest("/api/me/connection-requests", ben.id)).json()) as RequestList).outgoing).toEqual([]);

    expect((await rest(`/api/me/connections/${ana.handle}`, ben.id, { method: "DELETE" })).status).toBe(200);
    expect(((await (await rest("/api/me/connections", ana.id)).json()) as ConnectionList).connections).toEqual([]);
    expect((await connectWith(undefined, ben, (await inviteOf(ben)).token)).status).toBe(401);
  });
});

describe("share-link invites", () => {
  const connections = async (who: Me) =>
    ((await (await rest("/api/me/connections", who.id)).json()) as ConnectionList).connections;

  it("refuses a bare handle, a wrong token and a rotated one, and connects no one; the current token connects", async () => {
    const [ana, ben] = [await signIn("Ana Silva"), await signIn("Ben Ode")];
    const first = await inviteOf(ben);
    expect(first.path).toBe(`/@${ben.handle}?invite=${first.token}`);
    expect((await inviteOf(ben)).token).toBe(first.token);

    const refusals = [
      // No body at all, as a bare form post or curl -X POST sends it.
      await call(`${origin}/api/attendees/${ben.handle}/connect`, {
        method: "POST",
        headers: { authorization: `Bearer dev:${ana.id}` },
      }),
      await connectWith(ana.id, ben, undefined, {}),
      await connectWith(ana.id, ben, ""),
      await connectWith(ana.id, ben, `${first.token.slice(0, -1)}x`),
      await connectWith(ana.id, ben, (await inviteOf(ana)).token),
    ];
    const rotated = (await (await rest("/api/me/invite/rotate", ben.id, { method: "POST" })).json()) as Invite;
    expect(rotated.token).not.toBe(first.token);
    refusals.push(await connectWith(ana.id, ben, first.token));
    for (const response of refusals) {
      expect(response.status).toBe(403);
      expect(((await response.json()) as { kind: string }).kind).toBe("forbidden");
    }
    expect(await connections(ana)).toEqual([]);

    // Refused, Ana can still ask; the request waits for Ben.
    const asked = (await (await rest("/api/me/connection-requests", ana.id, post({ handle: ben.handle }))).json()) as RequestResult;
    expect(asked.request.status).toBe("pending");

    expect((await connectWith(ana.id, ben, rotated.token)).status).toBe(200);
    expect((await connections(ana)).map((c) => c.person.handle)).toEqual([ben.handle]);
  });

  it("keeps existing connections when the owner rotates, and refuses connecting to yourself", async () => {
    const [ana, ben] = [await signIn("Ana Silva"), await signIn("Ben Ode")];
    await connect(ana, ben);
    await rest("/api/me/invite/rotate", ben.id, { method: "POST" });
    expect((await connections(ana)).map((c) => c.person.handle)).toEqual([ben.handle]);
    expect((await connectWith(ben.id, ben, (await inviteOf(ben)).token)).status).toBe(400);
  });

  it("never shows the invite to an agent token, nor lets one rotate it, and keeps it out of public resources", async () => {
    const ben = await signIn("Ben Ode");
    const invite = await inviteOf(ben);
    const issued = (await (await rest("/api/me/tokens", ben.id, post({ label: "agent" }))).json()) as IssuedAgentToken;
    const asAgent = { headers: { authorization: `Bearer ${issued.secret}` } };
    expect((await rest("/api/me/invite", undefined, asAgent)).status).toBe(403);
    expect((await rest("/api/me/invite/rotate", undefined, { method: "POST", ...asAgent })).status).toBe(403);
    expect((await inviteOf(ben)).token).toBe(invite.token);
    expect((await rest("/api/me/invite")).status).toBe(401);

    const publicBodies = [
      await (await rest(`/api/attendees/${ben.handle}`)).text(),
      await (await rest("/api/me", ben.id)).text(),
      await (await rest("/api/me", undefined, asAgent)).text(),
    ];
    for (const body of publicBodies) expect(body).not.toContain(invite.token);

    // The share sheet offers the same invite to its owner, and none to the agent.
    const sheet = (await (await rest("/api/me/share", ben.id)).json()) as ShareLinks;
    expect(sheet.inviteUrl).toBe(`${origin}${invite.path}`);
    expect(sheet.pageUrl).toBe(`${origin}/@${ben.handle}`);
    const agentSheet = (await (await rest("/api/me/share", undefined, asAgent)).json()) as ShareLinks;
    expect(agentSheet).not.toHaveProperty("inviteUrl");
  });
});

describe("LinkedIn Connections.csv and suggestions", () => {
  // Synthetic: notes before the header, a quoted comma, and no real person.
  const csv = (rows: string[]) =>
    [
      "Notes:",
      '"When exporting your connection data, you may notice that some of the email addresses are missing."',
      "",
      "First Name,Last Name,URL,Email Address,Company,Position,Connected On",
      ...rows,
    ].join("\r\n");
  const upload = (as: string, body: string) =>
    rest("/api/me/contacts", as, { method: "POST", body, headers: { "content-type": "text/csv" } });

  it("suggests an attendee whose URL and verified name match, never one whose URL alone does", async () => {
    const me = await signIn("Me Myself");
    const ben = await signIn("Ben Ode");
    const cat = await signIn("Cat Ng");
    await rest("/api/me", ben.id, post({ linkedinProfileUrl: "https://www.linkedin.com/in/ben-ode" }, "PATCH"));
    // Cat claims a URL, but the contact at that URL has another name.
    await rest("/api/me", cat.id, post({ linkedinProfileUrl: "linkedin.com/in/cat-ng" }, "PATCH"));

    const imported = await upload(
      me.id,
      csv([
        'Ben,Ode,https://www.linkedin.com/in/ben-ode,,"Widgets, Inc.",Engineer,01 Jan 2024',
        "Someone,Else,https://www.linkedin.com/in/cat-ng,,Acme,Lead,02 Feb 2024",
        "No,Url,,,Acme,Lead,03 Mar 2024",
      ]),
    );
    expect(imported.status).toBe(200);
    expect(await imported.json()).toEqual({ importedAt: "2026-11-13T12:00:00.000Z", count: 2 });

    const listed = (await (await rest("/api/me/suggestions", me.id)).json()) as SuggestionList;
    expect(listed.suggestions).toEqual([
      { person: expect.objectContaining({ handle: ben.handle }), reason: "profile-and-name" },
    ]);
    expect(JSON.stringify(listed)).not.toContain("Widgets");

    // A pending request, then a connection, takes them out of suggestions.
    await rest("/api/me/connection-requests", me.id, post({ handle: ben.handle }));
    expect(((await (await rest("/api/me/suggestions", me.id)).json()) as SuggestionList).suggestions).toEqual([]);
  });

  it("refuses a file that is not LinkedIn's export, and replaces the last upload", async () => {
    const me = await signIn("Me Myself");
    expect((await upload(me.id, "name,email\nx,y")).status).toBe(400);
    await upload(me.id, csv(["A,B,https://www.linkedin.com/in/a-b,,,,", "C,D,https://www.linkedin.com/in/c-d,,,,"]));
    await upload(me.id, csv(["E,F,https://www.linkedin.com/in/e-f,,,,"]));
    expect(((await (await rest("/api/me/suggestions", me.id)).json()) as SuggestionList).contactImport?.count).toBe(1);
    expect((await upload("", csv([]))).status).toBe(401);
  });
});

/**
 * The viewer is Ana. Ben (connections) and Cat (private) are connected to
 * her; Dev (connections) and Eve (public) are not. All five plan s-shared,
 * Ben with a seat (reserved), the rest as a favorite; Ben also reserves
 * s-hidden and hides it; Dev plans s-dev.
 */
async function theirWeek() {
  const ana = await signIn("Ana Silva", "network");
  const ben = await signIn("Ben Ode", "network");
  const cat = await signIn("Cat Ng", "private");
  const dev = await signIn("Dev Rao", "network");
  const eve = await signIn("Eve Park", "public");
  const shared = aws("s-shared", "10:00");
  await sync(ana.id, [shared]);
  await sync(ben.id, [shared, aws("s-hidden", "13:00")], [], ["s-shared", "s-hidden"]);
  await hide(ben.id, "s-hidden");
  await sync(cat.id, [shared]);
  await sync(dev.id, [shared, aws("s-dev", "15:00")]);
  await sync(eve.id, [shared]);
  await connect(ana, ben);
  await connect(ana, cat);
  return { ana, ben, cat, dev, eve };
}

describe("every read of someone else's schedule goes through the visibility rule", () => {
  it("person schedule, REST and MCP: a connection sees all but hidden; private and non-connections see nothing", async () => {
    const { ana, ben, cat, dev, eve } = await theirWeek();
    const viaRest = async (who: Me) => rest(`/api/attendees/${who.handle}/schedule?eventId=reinvent2026`, ana.id);
    const viaMcp = (who: Me) => mcpTool<PersonSchedule>(ana.id, "get_person_schedule", { handle: who.handle, eventId: "reinvent2026" });

    const bens = (await (await viaRest(ben)).json()) as PersonSchedule;
    expect(bens.entries.map((e) => e.sessionId)).toEqual(["s-shared"]);
    expect((await viaMcp(ben)).value?.entries.map((e) => e.sessionId)).toEqual(["s-shared"]);
    expect(((await (await viaRest(eve)).json()) as PersonSchedule).entries.map((e) => e.sessionId)).toEqual(["s-shared"]);
    for (const hiddenFromAna of [cat, dev]) {
      expect((await viaRest(hiddenFromAna)).status).toBe(403);
      expect((await viaMcp(hiddenFromAna)).error?.kind).toBe("forbidden");
    }
    expect((await rest(`/api/attendees/${ben.handle}/schedule?eventId=reinvent2026`)).status).toBe(403);

    // Ben sees his own hidden entry, marked.
    const own = (await (await rest(`/api/attendees/${ben.handle}/schedule?eventId=reinvent2026`, ben.id)).json()) as PersonSchedule;
    expect(own.entries.map((e) => [e.sessionId, e.hidden])).toEqual([["s-shared", false], ["s-hidden", true]]);
  });

  it("attendee card: scheduleVisible follows the real connections", async () => {
    const { ana, ben, cat, dev } = await theirWeek();
    const card = async (who: Me) => (await (await rest(`/api/attendees/${who.handle}`, ana.id)).json()) as AttendeeCard;
    expect((await card(ben)).scheduleVisible).toBe(true);
    expect((await card(cat)).scheduleVisible).toBe(false);
    expect((await card(dev)).scheduleVisible).toBe(false);
  });

  it("who is going, REST and MCP: only visible connections with their intent, never a hidden entry", async () => {
    const { ana, ben } = await theirWeek();
    const ids = ["s-shared", "s-hidden", "s-dev"];
    // Ben's hidden s-hidden is reserved too: it lends him neither a place nor an intent.
    const expected = [
      { sessionId: "s-shared", people: [expect.objectContaining({ handle: ben.handle, intent: "reserved" })] },
      { sessionId: "s-hidden", people: [] },
      { sessionId: "s-dev", people: [] },
    ];
    const viaRest = (await (await rest(`/api/events/reinvent2026/who-is-going?sessionIds=${ids.join(",")}`, ana.id)).json()) as WhoIsGoing;
    expect(viaRest.sessions).toEqual(expected);
    const viaMcp = await mcpTool<WhoIsGoing>(ana.id, "who_is_going", { eventId: "reinvent2026", sessionIds: ids });
    expect(viaMcp.value?.sessions).toEqual(expected);
  });

  it("network agenda, REST and MCP: only visible connections, never a hidden entry", async () => {
    const { ana, ben } = await theirWeek();
    const viaRest = (await (await rest("/api/events/reinvent2026/network-agenda?day=2026-12-01", ana.id)).json()) as NetworkAgenda;
    const viaMcp = await mcpTool<NetworkAgenda>(ana.id, "network_agenda", { eventId: "reinvent2026", day: "2026-12-01" });
    for (const agenda of [viaRest, viaMcp.value!]) {
      expect(agenda.items.map((i) => [i.session.sessionId, i.people.map((p) => [p.handle, p.intent])])).toEqual([
        ["s-shared", [[ben.handle, "reserved"]]],
      ]);
    }
  });

  it("session search and get, REST and MCP: the connections-going count leaves out the hidden and the invisible", async () => {
    const { ana, ben } = await theirWeek();
    const search = (await (await rest("/api/events/reinvent2026/sessions", ana.id)).json()) as SessionList;
    const counts = Object.fromEntries(search.sessions.map((s) => [s.sessionId, s.connectionsGoing?.count]));
    expect(counts).toEqual({ "s-shared": 1, "s-hidden": 0, "s-dev": 0 });
    const shared = search.sessions.find((s) => s.sessionId === "s-shared")!;
    expect(shared.connectionsGoing?.people.map((p) => [p.handle, p.intent])).toEqual([[ben.handle, "reserved"]]);

    const one = (await (await rest("/api/events/reinvent2026/sessions/s-hidden", ana.id)).json()) as Session;
    expect(one.connectionsGoing).toEqual({ count: 0, people: [] });
    const viaMcp = await mcpTool<SessionList>(ana.id, "search_sessions", { eventId: "reinvent2026" });
    expect(viaMcp.value?.sessions.map((s) => s.connectionsGoing?.count)).toEqual([1, 0, 0]);

    const anonymous = (await (await rest("/api/events/reinvent2026/sessions/s-shared")).json()) as Session;
    expect(anonymous).not.toHaveProperty("connectionsGoing");
  });

  it("connection counts, REST and MCP: only sessions I may see, never a hidden entry or a private schedule", async () => {
    const { ana, ben, cat } = await theirWeek();
    // Ben adds a session Ana has not planned; his hidden s-hidden stays hidden through the sync.
    // Ana plans s-hidden too: hidden, it is not one she shares with him.
    await sync(ana.id, [aws("s-shared", "10:00"), aws("s-hidden", "13:00")]);
    await sync(ben.id, [aws("s-shared", "10:00"), aws("s-hidden", "13:00"), aws("s-ben", "16:00")], ["s-ben"], [
      "s-shared",
      "s-hidden",
    ]);
    const expected = [
      { handle: ben.handle, sessions: 2, sharedWithMe: 1 },
      // Cat is a connection whose schedule is private: nothing of hers counts.
      { handle: cat.handle, sessions: 0, sharedWithMe: 0 },
    ];
    const counts = (list: ConnectionList) =>
      list.connections.map((c) => ({ handle: c.person.handle, sessions: c.sessions, sharedWithMe: c.sharedWithMe }));

    const viaRest = (await (await rest("/api/me/connections?eventId=reinvent2026", ana.id)).json()) as ConnectionList;
    expect(counts(viaRest)).toEqual(expected);
    for (const tool of ["list_my_network", "list_my_connections"]) {
      const viaMcp = await mcpTool<NetworkList>(ana.id, tool, { eventId: "reinvent2026" });
      expect(viaMcp.value?.people.map((p) => ({ handle: p.person.handle, sessions: p.sessions, sharedWithMe: p.sharedWithMe }))).toEqual(
        expected,
      );
    }
    const viaNetwork = (await (await rest("/api/me/network?eventId=reinvent2026", ana.id)).json()) as NetworkList;
    expect(viaNetwork.people.map((p) => [p.person.handle, p.how, p.scheduleVisible])).toEqual([
      [ben.handle, ["connection"], true],
      [cat.handle, ["connection"], false],
    ]);

    // Without an event, no counts; an event that does not exist is not found.
    const plain = (await (await rest("/api/me/connections", ana.id)).json()) as ConnectionList;
    expect(plain.connections.every((c) => !("sessions" in c) && !("sharedWithMe" in c))).toBe(true);
    expect((await rest("/api/me/connections?eventId=reinvent1999", ana.id)).status).toBe(404);
  });

  it("meeting gaps, REST and MCP: a hidden entry does not block, an invisible schedule is refused", async () => {
    const { ana, ben, cat, dev } = await theirWeek();
    const viaRest = (await (
      await rest(`/api/events/reinvent2026/meeting-gaps?handle=${ben.handle}&day=2026-12-01`, ana.id)
    ).json()) as MeetingGaps;
    const viaMcp = await mcpTool<MeetingGaps>(ana.id, "find_meeting_gaps", {
      eventId: "reinvent2026",
      handle: ben.handle,
      day: "2026-12-01",
    });
    for (const result of [viaRest, viaMcp.value!]) {
      // Only s-shared (10:00 to 11:00) blocks; Ben's hidden 13:00 does not.
      expect(result.gaps.map((g) => [g.start, g.end])).toEqual([["08:00", "10:00"], ["11:00", "18:00"]]);
    }
    for (const who of [cat, dev]) {
      expect((await rest(`/api/events/reinvent2026/meeting-gaps?handle=${who.handle}&day=2026-12-01`, ana.id)).status).toBe(403);
      const refused = await mcpTool(ana.id, "find_meeting_gaps", { eventId: "reinvent2026", handle: who.handle, day: "2026-12-01" });
      expect(refused.error?.kind).toBe("forbidden");
    }
  });
});

describe("network MCP tools", () => {
  it("lists my network, and describes each tool in planning terms", async () => {
    const { ana, ben, cat } = await theirWeek();
    const listed = await mcpTool<NetworkList>(ana.id, "list_my_network");
    expect(listed.value?.people.map((p) => p.person.handle)).toEqual([ben.handle, cat.handle]);

    const client = new Client({ name: "network-test", version: "0.0.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL("/mcp", origin), { fetch: call }));
    const tools = Object.fromEntries((await client.listTools()).tools.map((t) => [t.name, t.description]));
    await client.close();
    for (const [name, description] of Object.entries(networkToolDescriptions)) expect(tools[name]).toBe(description);
    expect(networkToolDescriptions.who_is_going).toContain("Before choosing between two sessions");
  });
});
