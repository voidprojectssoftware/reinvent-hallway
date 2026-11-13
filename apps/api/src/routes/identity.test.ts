// Identity through the app's two interfaces, over the in-memory fakes and the
// fake LinkedIn: a browser (cookies, redirects) and an agent (bearer token,
// MCP with the SDK's own client) both reach the same handlers.
import { describe, expect, it } from "vitest";
import { getEvent, identityHandlers, scheduleHandlers } from "@hallway/application";
import {
  eventsInMemory,
  fakeLinkedIn,
  identityInMemory,
  linkedInOidc,
  reinvent2026,
  scheduleInMemory,
} from "@hallway/infrastructure";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { AgentTokenList, CalendarFeed, IssuedAgentToken, Me } from "@hallway/contracts";
import { createApp } from "../app.ts";

const origin = "http://127.0.0.1:8787";

/** The handlers this file does not exercise, so the app has every one it needs. */
function otherHandlers() {
  const events = eventsInMemory([reinvent2026]);
  return {
    getEvent: getEvent(events),
    ...scheduleHandlers({
      events,
      schedule: scheduleInMemory(),
      sessionUrlTemplate: "https://example.test/catalog?search={code}",
      now: () => new Date(),
    }),
  };
}

function world(bindings: { DEV_SIGN_IN?: string } = { DEV_SIGN_IN: "1" }) {
  const linkedIn = fakeLinkedIn();
  const identity = identityHandlers(identityInMemory({ linkedIn: linkedInOidc(linkedIn) }));
  const others = otherHandlers();
  const app = createApp<typeof bindings>({ handlers: () => ({ ...others, identity }) });
  const call = async (input: string | URL | Request, init?: RequestInit) =>
    app.fetch(new Request(input, init), bindings);
  return { linkedIn, call };
}

/** A browser's cookie jar, reduced to what these routes set: name=value pairs. */
class Browser {
  private jar = new Map<string, string>();
  constructor(private readonly call: (input: string, init?: RequestInit) => Promise<Response>) {}

  async fetch(path: string, init: RequestInit = {}) {
    const headers = new Headers(init.headers);
    if (this.jar.size) headers.set("cookie", [...this.jar].map(([k, v]) => `${k}=${v}`).join("; "));
    const response = await this.call(path.startsWith("http") ? path : `${origin}${path}`, { ...init, headers });
    for (const cookie of response.headers.getSetCookie()) {
      const [pair = ""] = cookie.split(";");
      const [name = "", value = ""] = pair.split("=");
      if (value === "" || /max-age=0/i.test(cookie)) this.jar.delete(name);
      else this.jar.set(name, value);
    }
    return response;
  }

  cookie(name: string) {
    return this.jar.get(name);
  }
}

const postJson = (body: unknown, method = "POST"): RequestInit => ({
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

async function devSignedIn(name = "Jane Doe") {
  const w = world();
  const browser = new Browser(w.call);
  const response = await browser.fetch("/api/dev/sign-in", postJson({ name }));
  expect(response.status).toBe(200);
  return { ...w, browser, response };
}

describe("GET /api/auth/options", () => {
  it("offers dev sign-in only where it is allowed, and LinkedIn only when configured", async () => {
    const options = async (call: (input: string) => Promise<Response>, url = `${origin}/api/auth/options`) =>
      (await call(url)).json();
    expect(await options(world().call)).toEqual({ devSignIn: true, linkedIn: true });
    expect(await options(world({}).call)).toEqual({ devSignIn: false, linkedIn: true });
    expect(await options(world().call, "https://hallway.example/api/auth/options")).toEqual({ devSignIn: false, linkedIn: true });

    const unconfigured = createApp<object>({
      handlers: () => ({ ...otherHandlers(), identity: identityHandlers(identityInMemory()) }),
    });
    const response = await unconfigured.fetch(new Request(`${origin}/api/auth/options`), {});
    expect(await response.json()).toEqual({ devSignIn: false, linkedIn: false });
  });
});

describe("dev sign-in", () => {
  it("creates the attendee, sets an HttpOnly SameSite=Lax session cookie, and /api/me answers", async () => {
    const { browser, response } = await devSignedIn();
    const cookie = response.headers.getSetCookie().find((c) => c.startsWith("hallway_session="));
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Lax/);
    expect(cookie).toMatch(/Path=\//);

    const me = await browser.fetch("/api/me");
    expect(me.status).toBe(200);
    expect(await me.json()).toMatchObject({ handle: "jane-doe", displayName: "Jane Doe", verifiedName: "Jane Doe" });
  });

  it("leaves Secure off only on plain http to a loopback host", async () => {
    const { response } = await devSignedIn();
    expect(response.headers.getSetCookie().join()).not.toMatch(/Secure/);

    const { call } = world();
    const overTls = await call("https://localhost:8787/api/dev/sign-in", postJson({ name: "Jane" }));
    expect(overTls.headers.getSetCookie().join()).toMatch(/Secure/);
  });

  it("is not there when DEV_SIGN_IN is off, or on a host that is not loopback", async () => {
    const off = world({});
    expect((await off.call(`${origin}/api/dev/sign-in`, postJson({ name: "Jane" }))).status).toBe(404);
    const on = world();
    expect((await on.call("https://hallway.example/api/dev/sign-in", postJson({ name: "Jane" }))).status).toBe(404);
  });

  it("signs out: the cookie is cleared and the old session no longer works", async () => {
    const { browser, call } = await devSignedIn();
    const secret = browser.cookie("hallway_session");
    expect((await browser.fetch("/api/auth/sign-out", { method: "POST" })).status).toBe(204);
    expect(browser.cookie("hallway_session")).toBeUndefined();
    const replay = await call(`${origin}/api/me`, { headers: { cookie: `hallway_session=${secret}` } });
    expect(replay.status).toBe(401);
  });

  it("treats a stale or made-up session cookie as anonymous, not an error", async () => {
    const { call } = world();
    const events = await call(`${origin}/api/events/reinvent2026`, { headers: { cookie: "hallway_session=nope" } });
    expect(events.status).toBe(200);
    const me = await call(`${origin}/api/me`, { headers: { cookie: "hallway_session=nope" } });
    expect(me.status).toBe(401);
  });
});

describe("Sign In with LinkedIn, against the fake provider", () => {
  const jane = { sub: "li-jane", name: "Jane Doe", email: "jane@example.com", email_verified: true };

  async function startAt(browser: Browser) {
    const start = await browser.fetch("/api/auth/linkedin");
    expect(start.status).toBe(302);
    const location = new URL(start.headers.get("location") ?? "");
    const stateCookie = start.headers.getSetCookie().find((c) => c.startsWith("hallway_oauth_state="));
    expect(stateCookie).toMatch(/HttpOnly/);
    expect(stateCookie).toMatch(/Path=\/api\/auth\/linkedin\/callback/);
    return {
      state: location.searchParams.get("state") ?? "",
      redirectUri: location.searchParams.get("redirect_uri") ?? "",
    };
  }

  it("goes to LinkedIn and back, sets the session, and the attendee carries LinkedIn's verified facts", async () => {
    const { linkedIn, call } = world();
    const browser = new Browser(call);
    const { state, redirectUri } = await startAt(browser);
    expect(redirectUri).toBe(`${origin}/api/auth/linkedin/callback`);

    const code = linkedIn.issueCode(jane, redirectUri);
    const back = await browser.fetch(`/api/auth/linkedin/callback?code=${code}&state=${state}`);
    expect(back.status).toBe(302);
    expect(back.headers.get("location")).toBe("/");
    expect(browser.cookie("hallway_oauth_state")).toBeUndefined();

    const me = (await (await browser.fetch("/api/me")).json()) as Me;
    expect(me).toMatchObject({ handle: "jane-doe", verifiedName: "Jane Doe", email: "jane@example.com" });
  });

  it("refuses a callback in a browser that did not start the sign-in", async () => {
    const { linkedIn, call } = world();
    const victim = new Browser(call);
    const { state, redirectUri } = await startAt(new Browser(call));
    const code = linkedIn.issueCode(jane, redirectUri);
    const forged = await victim.fetch(`/api/auth/linkedin/callback?code=${code}&state=${state}`);
    expect(forged.status).toBe(403);
    expect(victim.cookie("hallway_session")).toBeUndefined();
  });

  it("refuses a callback whose state differs from the cookie's, and a second use of the same state", async () => {
    const { linkedIn, call } = world();
    const browser = new Browser(call);
    const { state, redirectUri } = await startAt(browser);
    const wrong = await browser.fetch(`/api/auth/linkedin/callback?code=${linkedIn.issueCode(jane, redirectUri)}&state=other`);
    expect(wrong.status).toBe(403);
    const replay = await browser.fetch(`/api/auth/linkedin/callback?code=${linkedIn.issueCode(jane, redirectUri)}&state=${state}`);
    expect(replay.status).toBe(403);
  });

  it("does not keep an email LinkedIn did not verify", async () => {
    const { linkedIn, call } = world();
    const browser = new Browser(call);
    const { state, redirectUri } = await startAt(browser);
    const code = linkedIn.issueCode({ ...jane, email_verified: false }, redirectUri);
    await browser.fetch(`/api/auth/linkedin/callback?code=${code}&state=${state}`);
    expect(await (await browser.fetch("/api/me")).json()).not.toHaveProperty("email");
  });

  it("answers 404 when LinkedIn is not configured", async () => {
    const app = createApp<object>({
      handlers: () => ({ ...otherHandlers(), identity: identityHandlers(identityInMemory()) }),
    });
    expect((await app.fetch(new Request(`${origin}/api/auth/linkedin`), {})).status).toBe(404);
  });
});

describe("agent tokens", () => {
  async function mcp(call: (input: string | URL | Request, init?: RequestInit) => Promise<Response>, token: string) {
    const client = new Client({ name: "identity-test", version: "0.0.0" });
    await client.connect(
      new StreamableHTTPClientTransport(new URL("/mcp", origin), {
        fetch: call,
        requestInit: { headers: { authorization: `Bearer ${token}` } },
      }),
    );
    return client;
  }

  it("issue, whoami over MCP, revoke, and the token is refused after", async () => {
    const { browser, call } = await devSignedIn();
    const issued = (await (await browser.fetch("/api/me/tokens", postJson({ label: "laptop" }))).json()) as IssuedAgentToken;
    expect(issued.secret).toMatch(/^hw_[A-Za-z0-9_-]{43}$/);

    const client = await mcp(call, issued.secret);
    const whoami = await client.callTool({ name: "whoami", arguments: {} });
    expect(whoami.structuredContent).toMatchObject({ handle: "jane-doe" });
    await client.close();

    const listed = (await (await browser.fetch("/api/me/tokens")).json()) as AgentTokenList;
    expect(listed.tokens).toEqual([expect.objectContaining({ id: issued.token.id, lastUsedAt: expect.any(String) })]);
    expect(JSON.stringify(listed)).not.toContain(issued.secret);

    const revoked = await browser.fetch(`/api/me/tokens/${issued.token.id}`, { method: "DELETE" });
    expect(await revoked.json()).toMatchObject({ revokedAt: expect.any(String) });

    const refused = await call(`${origin}/mcp`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${issued.secret}`,
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "whoami", arguments: {} } }),
    });
    expect(refused.status).toBe(401);
    expect(await refused.json()).toEqual({ kind: "unauthenticated", message: "The agent token is unknown or revoked." });
  });

  it("works as a bearer on REST too, and acts only as its attendee", async () => {
    const { browser, call } = await devSignedIn();
    const issued = (await (await browser.fetch("/api/me/tokens", postJson({ label: "cli" }))).json()) as IssuedAgentToken;
    const me = await call(`${origin}/api/me`, { headers: { authorization: `Bearer ${issued.secret}` } });
    expect(await me.json()).toMatchObject({ handle: "jane-doe" });
  });

  it("cannot manage tokens or the calendar feed (403), where the session cookie can", async () => {
    const { browser, call } = await devSignedIn();
    const issued = (await (await browser.fetch("/api/me/tokens", postJson({ label: "cli" }))).json()) as IssuedAgentToken;
    const asAgent = (path: string, init: RequestInit = {}) =>
      call(`${origin}${path}`, {
        ...init,
        headers: { ...Object.fromEntries(new Headers(init.headers)), authorization: `Bearer ${issued.secret}` },
      });

    const minted = await asAgent("/api/me/tokens", postJson({ label: "a second token" }));
    expect(minted.status).toBe(403);
    expect(await minted.json()).toMatchObject({ kind: "forbidden" });
    expect((await asAgent("/api/me/tokens")).status).toBe(403);
    expect((await asAgent(`/api/me/tokens/${issued.token.id}`, { method: "DELETE" })).status).toBe(403);
    expect((await asAgent("/api/me/calendar-feed/rotate", { method: "POST" })).status).toBe(403);
    expect((await asAgent("/api/me/calendar-feed")).status).toBe(403);

    expect((await browser.fetch("/api/me/tokens", postJson({ label: "from the web" }))).status).toBe(200);
    const listed = (await (await browser.fetch("/api/me/tokens")).json()) as AgentTokenList;
    expect(listed.tokens.map((token) => token.label)).toEqual(["cli", "from the web"]);
  });

  it("whoami without a credential is a tool error, not a crash", async () => {
    const { call } = world();
    const client = new Client({ name: "identity-test", version: "0.0.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL("/mcp", origin), { fetch: call }));
    const result = await client.callTool({ name: "whoami", arguments: {} });
    expect(result.isError).toBe(true);
    await client.close();
  });
});

describe("the dev bearer, kept for local curl and later slices' evidence", () => {
  it("acts as the attendee id it names when dev sign-in is allowed", async () => {
    const { browser, call } = await devSignedIn();
    const me = (await (await browser.fetch("/api/me")).json()) as Me;
    const viaBearer = await call(`${origin}/api/me`, { headers: { authorization: `Bearer dev:${me.id}` } });
    expect(await viaBearer.json()).toMatchObject({ id: me.id });
  });

  it("is refused when dev sign-in is off, and any other bearer is refused", async () => {
    const { call } = world({});
    expect((await call(`${origin}/api/me`, { headers: { authorization: "Bearer dev:abc" } })).status).toBe(401);
    expect((await call(`${origin}/api/me`, { headers: { authorization: "Bearer something" } })).status).toBe(401);
  });
});

describe("profile, visibility, attendee card, calendar feed", () => {
  it("updates the profile and visibility", async () => {
    const { browser } = await devSignedIn();
    const patched = await browser.fetch("/api/me", postJson({ handle: "@JaneD", headline: "Builder" }, "PATCH"));
    expect(await patched.json()).toMatchObject({ handle: "janed", headline: "Builder" });
    const reserved = await browser.fetch("/api/me", postJson({ handle: "settings" }, "PATCH"));
    expect(reserved.status).toBe(409);
    const visibility = await browser.fetch("/api/me/visibility", postJson({ visibility: "public" }, "PUT"));
    expect(await visibility.json()).toMatchObject({ visibility: "public" });
    const bad = await browser.fetch("/api/me/visibility", postJson({ visibility: "everyone" }, "PUT"));
    expect(bad.status).toBe(400);
  });

  it("serves the public card without email, linkedinSub or verifiedName", async () => {
    const { browser, call } = await devSignedIn();
    await browser.fetch("/api/me/visibility", postJson({ visibility: "private" }, "PUT"));
    const response = await call(`${origin}/api/attendees/jane-doe`);
    const card = (await response.json()) as Record<string, unknown>;
    expect(card).toMatchObject({ handle: "jane-doe", displayName: "Jane Doe", scheduleVisible: false });
    for (const key of ["email", "linkedinSub", "verifiedName", "verifiedEmailSha256"]) expect(card).not.toHaveProperty(key);
  });

  it("rotates the calendar feed to a new secret each time, and shows the current one again without rotating", async () => {
    const { browser, call } = await devSignedIn();
    expect((await browser.fetch("/api/me/calendar-feed")).status).toBe(404);
    const one = (await (await browser.fetch("/api/me/calendar-feed/rotate", { method: "POST" })).json()) as CalendarFeed;
    const two = (await (await browser.fetch("/api/me/calendar-feed/rotate", { method: "POST" })).json()) as CalendarFeed;
    expect(one.token).not.toBe(two.token);
    expect(two.path).toBe(`/cal/${two.token}.ics`);
    expect(await (await browser.fetch("/api/me/calendar-feed")).json()).toEqual(two);

    const me = await (await browser.fetch("/api/me")).text();
    const card = await (await call(`${origin}/api/attendees/jane-doe`)).text();
    expect(me).not.toContain(two.token);
    expect(card).not.toContain(two.token);
  });

  it("refuses every /api/me route to an anonymous caller with 401", async () => {
    const { call } = world();
    for (const [path, method] of [
      ["/api/me", "GET"],
      ["/api/me/tokens", "GET"],
      ["/api/me/calendar-feed/rotate", "POST"],
    ] as const) {
      expect((await call(`${origin}${path}`, { method })).status).toBe(401);
    }
  });
});
