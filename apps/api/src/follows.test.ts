// Follows from GitHub and LinkedIn (ADR 0019, #63) through both interfaces,
// over the in-memory fakes and the real GitHub adapter against its fake.
// The issue's evidence, case by case:
//   A. Ana follows Ben on GitHub and Ben is network-only: Ana cannot see Ben's week.
//   B. Ben follows Ana back: now Ana can.
//   C. Ana's LinkedIn import matches Cat: Cat sees Ana's network-only week.
// and around them: who is going, the agenda, gaps and session search count
// only the followed people who share with the viewer; a GitHub follow of
// someone not yet here reaches them when they link GitHub; unlinking GitHub
// forgets; the refresh round trip is the person's, never an agent's.
import { beforeEach, describe, expect, it } from "vitest";
import type {
  AttendeeCard,
  Following,
  GitHubRoundTrip,
  IssuedAgentToken,
  MeetingGaps,
  Me,
  NetworkAgenda,
  NetworkList,
  PersonSchedule,
  SessionList,
  WhoIsGoing,
} from "@hallway/contracts";
import { fakeGitHub, gitHubOAuth, type FakeGitHub } from "@hallway/infrastructure";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createApp } from "./app.ts";
import { Browser, origin } from "./testing/browser.ts";
import { inMemoryHandlers, noPng } from "./testing/in-memory-handlers.ts";

const bindings = { DEV_SIGN_IN: "1" };
const eventId = "reinvent2026";
let call: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
let github: FakeGitHub;

beforeEach(() => {
  github = fakeGitHub();
  const { handlers } = inMemoryHandlers({
    now: () => new Date("2026-11-13T12:00:00.000Z"),
    identity: { providers: { github: gitHubOAuth(github) } },
  });
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
const json = async <T>(response: Response | Promise<Response>) => (await (await response).json()) as T;

async function mcpTool<T>(as: string, name: string, args: Record<string, unknown> = {}) {
  const client = new Client({ name: "follows-test", version: "0.0.0" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL("/mcp", origin), {
      fetch: call,
      requestInit: { headers: { authorization: `Bearer dev:${as}` } },
    }),
  );
  const result = await client.callTool({ name, arguments: args });
  await client.close();
  return result.isError
    ? { error: JSON.parse((result.content as { text: string }[])[0]!.text) as { kind: string; message: string } }
    : { value: result.structuredContent as T };
}

interface Person {
  me: Me;
  browser: Browser;
  gitHubId: number;
}

let nextGitHubId = 5000;
/** Signed in on the web (dev sign-in), `network` visibility unless told otherwise, with one session on Tuesday. */
async function person(name: string, sessionId: string, time = "10:00"): Promise<Person> {
  const browser = new Browser(call);
  const me = await json<Me>(
    browser.fetch("/api/dev/sign-in", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name }) }),
  );
  const session = { sessionId, abbreviation: sessionId.toUpperCase(), title: `Session ${sessionId}`, sessionTime: { date: "2026-12-01", time, length: "60" } };
  await rest(`/api/events/${eventId}/my-schedule`, me.id, post({ sessions: [session], favorites: [sessionId], reserved: [] }, "PUT"));
  return { me, browser, gitHubId: (nextGitHubId += 1) };
}

/**
 * "Refresh from GitHub" (or adding GitHub): the refresh route starts the
 * round trip, GitHub's fake consents as this person following those people,
 * and the callback stores the list.
 */
async function refreshFromGitHub(who: Person, following: Person[] | number[]) {
  const started = await who.browser.fetch("/api/me/following/github/refresh", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  expect(started.status).toBe(200);
  const url = new URL((await json<GitHubRoundTrip>(started)).authorizationUrl);
  const redirectUri = url.searchParams.get("redirect_uri") ?? "";
  const code = github.issueCode(
    {
      id: who.gitHubId,
      login: who.me.handle,
      name: who.me.displayName,
      emails: [],
      following: following.map((f) => (typeof f === "number" ? { id: f, login: `user${f}` } : { id: f.gitHubId, login: f.me.handle })),
    },
    redirectUri,
  );
  const back = await who.browser.fetch(`/api/auth/github/callback?code=${code}&state=${url.searchParams.get("state")}`);
  expect(back.status).toBe(302);
  expect(back.headers.get("location")).toBe("/network");
}

const scheduleOf = (viewer: Person, owner: Person) =>
  rest(`/api/attendees/${owner.me.handle}/schedule?eventId=${eventId}`, viewer.me.id);
const scheduleOverMcp = (viewer: Person, owner: Person) =>
  mcpTool<PersonSchedule>(viewer.me.id, "get_person_schedule", { eventId, handle: owner.me.handle });
const network = (who: Person) => json<NetworkList>(rest(`/api/me/network?eventId=${eventId}`, who.me.id));
const following = (who: Person) => json<Following>(rest(`/api/me/following?eventId=${eventId}`, who.me.id));

describe("A and B: following someone on GitHub never shows you their week; their following you does", () => {
  it("A: Ana follows Ben on GitHub, Ben is network-only, so Ana cannot see Ben's week, over REST and MCP", async () => {
    const [ana, ben] = [await person("Ana Silva", "s-ana", "09:00"), await person("Ben Ode", "s-ben", "14:00")];
    await refreshFromGitHub(ben, []);
    await refreshFromGitHub(ana, [ben]);

    expect((await scheduleOf(ana, ben)).status).toBe(403);
    const refused = await scheduleOverMcp(ana, ben);
    expect(refused.error?.kind).toBe("forbidden");
    expect(refused.error?.message).toContain("Following them does not change that");
    expect((await json<AttendeeCard>(rest(`/api/attendees/${ben.me.handle}`, ana.me.id))).scheduleVisible).toBe(false);
    expect((await rest(`/api/events/${eventId}/meeting-gaps?handle=${ben.me.handle}&day=2026-12-01`, ana.me.id)).status).toBe(403);

    // Ben is in Ana's network, labelled, with nothing of his week counted.
    const listed = { people: (await network(ana)).people.map((p) => [p.person.handle, p.how, p.scheduleVisible, p.sessions]) };
    expect(listed).toEqual({ people: [[ben.me.handle, ["github"], false, 0]] });
    const viaMcp = await mcpTool<NetworkList>(ana.me.id, "list_my_network", { eventId });
    expect(viaMcp.value?.people.map((p) => [p.person.handle, p.how, p.scheduleVisible])).toEqual([[ben.me.handle, ["github"], false]]);
    expect(await following(ana)).toEqual({
      github: {
        linked: true,
        people: [{ person: expect.objectContaining({ handle: ben.me.handle }), since: "2026-11-13T12:00:00.000Z", scheduleVisible: false, sessions: 0 }],
        notOnHallway: 0,
      },
      linkedinImport: { people: [] },
    });

    // Ben's session lends Ana nobody, on any path.
    const going = await json<WhoIsGoing>(rest(`/api/events/${eventId}/who-is-going?sessionIds=s-ben`, ana.me.id));
    expect(going.sessions).toEqual([{ sessionId: "s-ben", people: [] }]);
    const agenda = await mcpTool<NetworkAgenda>(ana.me.id, "network_agenda", { eventId, day: "2026-12-01" });
    expect(agenda.value?.items).toEqual([]);
    const search = await json<SessionList>(rest(`/api/events/${eventId}/sessions?q=s-ben`, ana.me.id));
    expect(search.sessions.map((s) => s.connectionsGoing?.count)).toEqual([0]);

    // And the other way: Ana follows Ben, which is her consent for Ben to see her week.
    const anas = await json<PersonSchedule>(scheduleOf(ben, ana));
    expect(anas.entries.map((e) => e.sessionId)).toEqual(["s-ana"]);
    expect((await scheduleOverMcp(ben, ana)).value?.entries.map((e) => e.sessionId)).toEqual(["s-ana"]);
    expect((await json<AttendeeCard>(rest(`/api/attendees/${ana.me.handle}`, ben.me.id))).scheduleVisible).toBe(true);
  });

  it("B: Ben follows Ana back, so Ana sees his week, and he counts in who is going, the agenda, gaps and search", async () => {
    const [ana, ben] = [await person("Ana Silva", "s-ana", "09:00"), await person("Ben Ode", "s-ben", "14:00")];
    await refreshFromGitHub(ana, [ben]);
    await refreshFromGitHub(ben, [ana]);

    expect((await json<PersonSchedule>(scheduleOf(ana, ben))).entries.map((e) => e.sessionId)).toEqual(["s-ben"]);
    expect((await scheduleOverMcp(ana, ben)).value?.entries.map((e) => e.sessionId)).toEqual(["s-ben"]);

    const benGoing = [expect.objectContaining({ handle: ben.me.handle, intent: "interested" })];
    const going = await json<WhoIsGoing>(rest(`/api/events/${eventId}/who-is-going?sessionIds=s-ben`, ana.me.id));
    expect(going.sessions).toEqual([{ sessionId: "s-ben", people: benGoing }]);
    const goingMcp = await mcpTool<WhoIsGoing>(ana.me.id, "who_is_going", { eventId, sessionIds: ["s-ben"] });
    expect(goingMcp.value?.sessions).toEqual([{ sessionId: "s-ben", people: benGoing }]);
    const agenda = await json<NetworkAgenda>(rest(`/api/events/${eventId}/network-agenda?day=2026-12-01`, ana.me.id));
    expect(agenda.items.map((i) => [i.session.sessionId, i.people.map((p) => p.handle)])).toEqual([["s-ben", [ben.me.handle]]]);
    const gaps = await mcpTool<MeetingGaps>(ana.me.id, "find_meeting_gaps", { eventId, handle: ben.me.handle, day: "2026-12-01" });
    expect(gaps.value?.gaps.map((g) => [g.start, g.end])).toEqual([
      ["08:00", "09:00"],
      ["10:00", "14:00"],
      ["15:00", "18:00"],
    ]);
    const search = await json<SessionList>(rest(`/api/events/${eventId}/sessions?q=s-ben`, ana.me.id));
    expect(search.sessions.map((s) => s.connectionsGoing?.count)).toEqual([1]);

    const listed = await network(ana);
    expect(listed.people.map((p) => [p.person.handle, p.how, p.scheduleVisible, p.sessions])).toEqual([
      [ben.me.handle, ["github"], true, 1],
    ]);
    // The old tool name answers the same, for one release.
    const old = await mcpTool<NetworkList>(ana.me.id, "list_my_connections", { eventId });
    expect(old.value).toEqual(listed);
  });

  it("a followed person's private schedule stays private, and a public one is visible to anyone", async () => {
    const [ana, ben, eve] = [await person("Ana Silva", "s-ana"), await person("Ben Ode", "s-ben"), await person("Eve Park", "s-eve")];
    await refreshFromGitHub(eve, []);
    await refreshFromGitHub(ana, [ben, eve]);
    await refreshFromGitHub(ben, [ana]);
    await rest("/api/me/visibility", ben.me.id, post({ visibility: "private" }, "PUT"));
    await rest("/api/me/visibility", eve.me.id, post({ visibility: "public" }, "PUT"));
    expect((await scheduleOf(ana, ben)).status).toBe(403);
    expect((await scheduleOf(ana, eve)).status).toBe(200);
    expect((await network(ana)).people.map((p) => [p.person.handle, p.scheduleVisible])).toEqual([
      [ben.me.handle, false],
      [eve.me.handle, true],
    ]);
  });
});

describe("GitHub follows of people not on Hallway yet", () => {
  it("count as not on Hallway, and reach the person when they link that GitHub account", async () => {
    const [ana, cat] = [await person("Ana Silva", "s-ana"), await person("Cat Ng", "s-cat")];
    await refreshFromGitHub(ana, [cat.gitHubId, 424242]);
    expect((await following(ana)).github).toMatchObject({ people: [], notOnHallway: 2 });
    expect((await scheduleOf(cat, ana)).status).toBe(403);

    await refreshFromGitHub(cat, []);
    expect((await following(ana)).github).toMatchObject({
      people: [expect.objectContaining({ person: expect.objectContaining({ handle: cat.me.handle }) })],
      notOnHallway: 1,
    });
    expect((await scheduleOf(cat, ana)).status).toBe(200);
  });

  it("are replaced by a refresh, and forgotten when GitHub is unlinked", async () => {
    const [ana, ben, cat] = [await person("Ana Silva", "s-ana"), await person("Ben Ode", "s-ben"), await person("Cat Ng", "s-cat")];
    await refreshFromGitHub(ben, []);
    await refreshFromGitHub(cat, []);
    await refreshFromGitHub(ana, [ben]);
    expect((await scheduleOf(ben, ana)).status).toBe(200);

    await refreshFromGitHub(ana, [cat]);
    expect((await scheduleOf(ben, ana)).status).toBe(403);
    expect((await scheduleOf(cat, ana)).status).toBe(200);

    expect((await ana.browser.fetch("/api/me/identities/github", { method: "DELETE" })).status).toBe(200);
    expect((await scheduleOf(cat, ana)).status).toBe(403);
    expect((await following(ana)).github).toEqual({ linked: false, people: [], notOnHallway: 0 });
  });
});

describe("C: a LinkedIn import that matches someone makes them someone I follow", () => {
  const csv = (rows: string[]) =>
    ["Notes:", "", "First Name,Last Name,URL,Email Address,Company,Position,Connected On", ...rows].join("\r\n");
  const upload = (who: Person, rows: string[]) =>
    rest("/api/me/contacts", who.me.id, { method: "POST", body: csv(rows), headers: { "content-type": "text/csv" } });

  it("lets Cat see Ana's network-only week, over REST and MCP, and not the other way round", async () => {
    const [ana, cat] = [await person("Ana Silva", "s-ana"), await person("Cat Ng", "s-cat")];
    await rest("/api/me", cat.me.id, post({ linkedinProfileUrl: "https://www.linkedin.com/in/cat-ng" }, "PATCH"));
    expect((await scheduleOf(cat, ana)).status).toBe(403);

    expect((await upload(ana, ["Cat,Ng,https://www.linkedin.com/in/cat-ng,,Acme,Lead,01 Jan 2024"])).status).toBe(200);
    expect((await json<PersonSchedule>(scheduleOf(cat, ana))).entries.map((e) => e.sessionId)).toEqual(["s-ana"]);
    expect((await scheduleOverMcp(cat, ana)).value?.entries.map((e) => e.sessionId)).toEqual(["s-ana"]);
    expect((await scheduleOf(ana, cat)).status).toBe(403);
    expect((await scheduleOverMcp(ana, cat)).error?.kind).toBe("forbidden");
    expect((await following(ana)).linkedinImport.people.map((p) => [p.person.handle, p.scheduleVisible])).toEqual([
      [cat.me.handle, false],
    ]);
    expect((await network(ana)).people.map((p) => [p.person.handle, p.how])).toEqual([[cat.me.handle, ["linkedin-import"]]]);

    // A new upload without Cat replaces the follows it made.
    await upload(ana, ["Someone,Else,https://www.linkedin.com/in/someone-else,,,,"]);
    expect((await scheduleOf(cat, ana)).status).toBe(403);
    expect((await following(ana)).linkedinImport.people).toEqual([]);
  });

  it("never follows on a claimed URL alone", async () => {
    const [ana, mallory] = [await person("Ana Silva", "s-ana"), await person("Mallory", "s-m")];
    await rest("/api/me", mallory.me.id, post({ linkedinProfileUrl: "https://www.linkedin.com/in/cat-ng" }, "PATCH"));
    await upload(ana, ["Cat,Ng,https://www.linkedin.com/in/cat-ng,,,,"]);
    expect((await scheduleOf(mallory, ana)).status).toBe(403);
  });
});

describe("the GitHub refresh round trip", () => {
  it("is the person's: refused to an agent token and to nobody, and comes back to the page asked for", async () => {
    const ana = await person("Ana Silva", "s-ana");
    const issued = await json<IssuedAgentToken>(ana.browser.fetch("/api/me/tokens", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ label: "agent" }),
    }));
    const asAgent = await call(`${origin}/api/me/following/github/refresh`, {
      method: "POST",
      headers: { authorization: `Bearer ${issued.secret}` },
    });
    expect(asAgent.status).toBe(403);
    expect((await call(`${origin}/api/me/following/github/refresh`, { method: "POST" })).status).toBe(401);

    const started = await ana.browser.fetch("/api/me/following/github/refresh", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ returnTo: "//evil.example" }),
    });
    expect(started.status).toBe(400);
    const fine = await json<GitHubRoundTrip>(ana.browser.fetch("/api/me/following/github/refresh", { method: "POST" }));
    expect(new URL(fine.authorizationUrl).searchParams.get("redirect_uri")).toBe(`${origin}/api/auth/github/callback`);
    expect(ana.browser.cookie("hallway_oauth_state")).toBeDefined();
  });
});
