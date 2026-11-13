// Sign in with Google, Microsoft, LinkedIn and GitHub, and link them to one
// person (ADR 0018, #60), through the browser's routes. Each provider runs its
// real adapter against its own fake, so the evidence for each is the same
// list: first sign-in, the same account again, linking from a signed-in
// session, refusing an identity someone else holds, refusing a sign-in whose
// verified email is another account's, unlinking, and refusing the last.
import { describe, expect, it } from "vitest";
import { identityHandlers, type IdentityProviders } from "@hallway/application";
import type { IdentityList, Me, SignInProvider } from "@hallway/contracts";
import {
  fakeGitHub,
  fakeGoogle,
  fakeLinkedIn,
  fakeMicrosoft,
  gitHubOAuth,
  googleOidc,
  identityInMemory,
  linkedInOidc,
  microsoftOidc,
  personalAccountsTenant,
} from "@hallway/infrastructure";
import { createApp } from "../app.ts";
import { Browser, origin } from "../testing/browser.ts";
import { inMemoryHandlers } from "../testing/in-memory-handlers.ts";

/** A person at a provider, by a number that makes their subject, with or without a verified email. */
interface Person {
  n: number;
  name: string;
  email?: string;
  verified?: boolean;
}

function world() {
  const fakes = {
    google: fakeGoogle(),
    microsoft: fakeMicrosoft(),
    linkedin: fakeLinkedIn(),
    github: fakeGitHub(),
  };
  const providers: IdentityProviders = {
    google: googleOidc(fakes.google),
    microsoft: microsoftOidc(fakes.microsoft),
    linkedin: linkedInOidc(fakes.linkedin),
    github: gitHubOAuth(fakes.github),
  };
  const identity = identityHandlers(identityInMemory({ providers }));
  const others = inMemoryHandlers().handlers;
  const bindings = { DEV_SIGN_IN: "1" };
  const app = createApp<typeof bindings>({ handlers: () => ({ ...others, identity }), renderPng: async () => new Uint8Array() });
  const call = async (input: string | URL | Request, init?: RequestInit) => app.fetch(new Request(input, init), bindings);

  /** What each fake's consent would hand back for this person: each provider's own user shape. */
  const codeFor = (provider: SignInProvider, person: Person, redirectUri: string): string => {
    const { n, name, email, verified = true } = person;
    switch (provider) {
      case "google":
        return fakes.google.issueCode({ sub: `g-${n}`, name, ...(email && { email, email_verified: verified }) }, redirectUri);
      case "linkedin":
        return fakes.linkedin.issueCode({ sub: `li-${n}`, name, ...(email && { email, email_verified: verified }) }, redirectUri);
      case "microsoft":
        // Verified the way ADR 0018 allows: a personal account. A work account without xms_edov is not.
        return fakes.microsoft.issueCode(
          { sub: `ms-${n}`, name, tid: verified ? personalAccountsTenant : "a-work-tenant", ...(email && { email }) },
          redirectUri,
        );
      case "github":
        return fakes.github.issueCode(
          {
            id: 1000 + n,
            login: `user${n}`,
            name,
            emails: email ? [{ email, primary: true, verified }] : [],
            following: [{ id: 583231, login: "octocat" }],
          },
          redirectUri,
        );
    }
  };

  /** Start (optionally as a link) and come back through the provider's callback as `person`. */
  async function roundTrip(browser: Browser, provider: SignInProvider, person: Person, query = "") {
    const start = await browser.fetch(`/api/auth/${provider}${query}`);
    expect(start.status).toBe(302);
    const location = new URL(start.headers.get("location") ?? "");
    const redirectUri = location.searchParams.get("redirect_uri") ?? "";
    expect(redirectUri).toBe(`${origin}/api/auth/${provider}/callback`);
    const state = location.searchParams.get("state") ?? "";
    return browser.fetch(`/api/auth/${provider}/callback?code=${codeFor(provider, person, redirectUri)}&state=${state}`);
  }

  async function signedIn(provider: SignInProvider, person: Person) {
    const browser = new Browser(call);
    const back = await roundTrip(browser, provider, person);
    expect(back.headers.get("location")).toBe("/");
    const me = (await (await browser.fetch("/api/me")).json()) as Me;
    return { browser, me };
  }

  async function devSignedIn(name: string) {
    const browser = new Browser(call);
    const response = await browser.fetch("/api/dev/sign-in", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const me = (await response.json()) as Me;
    return { browser, me };
  }

  return { call, fakes, roundTrip, signedIn, devSignedIn };
}

const identitiesOf = async (browser: Browser) => ((await (await browser.fetch("/api/me/identities")).json()) as IdentityList).identities;

describe.each(["google", "microsoft", "linkedin", "github"] as const)("sign in with %s, against its fake", (provider) => {
  it("first sign-in creates the attendee; the second signs in to the same one", async () => {
    const w = world();
    const first = await w.signedIn(provider, { n: 1, name: "Jane Doe", email: "jane@example.com" });
    expect(first.me).toMatchObject({ handle: "jane-doe", verifiedName: "Jane Doe", email: "jane@example.com" });
    expect(first.browser.cookie("hallway_oauth_state")).toBeUndefined();
    expect(await identitiesOf(first.browser)).toEqual([
      expect.objectContaining({ provider, email: "jane@example.com", emailVerified: true }),
    ]);

    const second = await w.signedIn(provider, { n: 1, name: "Jane Doe", email: "jane@example.com" });
    expect(second.me.id).toBe(first.me.id);
  });

  it("links to the person signed in, who can then sign in with it, and come back where they started", async () => {
    const w = world();
    const { browser, me } = await w.devSignedIn("Sam Lee");
    const back = await w.roundTrip(browser, provider, { n: 2, name: "Sam Lee" }, "?link=1&returnTo=%2Fsettings");
    expect(back.headers.get("location")).toBe("/settings");
    expect((await identitiesOf(browser)).map((identity) => identity.provider)).toEqual(["dev", provider]);

    const viaProvider = await w.signedIn(provider, { n: 2, name: "Sam Lee" });
    expect(viaProvider.me.id).toBe(me.id);
  });

  it("refuses to link an identity another attendee holds, back on the page the link started from", async () => {
    const w = world();
    const owner = await w.signedIn(provider, { n: 3, name: "Owner" });
    const { browser } = await w.devSignedIn("Mallory");
    const back = await w.roundTrip(browser, provider, { n: 3, name: "Owner" }, "?link=1&returnTo=%2Fsettings");
    expect(back.headers.get("location")).toBe(`/settings?error=conflict&provider=${provider}`);
    expect((await identitiesOf(browser)).map((identity) => identity.provider)).toEqual(["dev"]);
    expect(await identitiesOf(owner.browser)).toHaveLength(1);
  });

  it("refuses a new sign-in whose verified email is another account's, with its own error kind", async () => {
    const w = world();
    const other: SignInProvider = provider === "google" ? "linkedin" : "google";
    await w.signedIn(other, { n: 4, name: "Pat Kim", email: "pat@example.com" });
    const browser = new Browser(w.call);
    const back = await w.roundTrip(browser, provider, { n: 4, name: "Pat Kim", email: "Pat@Example.com" }, "?returnTo=%2F%40sam");
    expect(back.headers.get("location")).toBe(`/sign-in?returnTo=%2F%40sam&error=account-exists&provider=${provider}`);
    expect(browser.cookie("hallway_session")).toBeUndefined();
  });

  it("lets the same email in when this provider does not vouch for it", async () => {
    const w = world();
    const other: SignInProvider = provider === "google" ? "linkedin" : "google";
    const holder = await w.signedIn(other, { n: 5, name: "Lee", email: "lee@example.com" });
    const unverified = await w.signedIn(provider, { n: 5, name: "Lee", email: "lee@example.com", verified: false });
    expect(unverified.me.id).not.toBe(holder.me.id);
    expect(unverified.me).not.toHaveProperty("email");
  });

  it("unlinks while another way in remains, and refuses the last (409)", async () => {
    const w = world();
    const { browser } = await w.signedIn(provider, { n: 6, name: "Uma" });
    const last = await browser.fetch(`/api/me/identities/${provider}`, { method: "DELETE" });
    expect(last.status).toBe(409);
    expect(await last.json()).toMatchObject({ kind: "conflict" });

    const other: SignInProvider = provider === "github" ? "google" : "github";
    await w.roundTrip(browser, other, { n: 6, name: "Uma" }, "?link=1");
    const unlinked = await browser.fetch(`/api/me/identities/${provider}`, { method: "DELETE" });
    expect(unlinked.status).toBe(200);
    expect(((await unlinked.json()) as IdentityList).identities.map((identity) => identity.provider)).toEqual([other]);
  });
});

describe("the four providers' routes", () => {
  it("lists all four in order when configured", async () => {
    const w = world();
    expect(await (await w.call(`${origin}/api/auth/options`)).json()).toEqual({
      devSignIn: true,
      providers: ["google", "microsoft", "linkedin", "github"],
      linkedIn: true,
    });
  });

  it("scopes each state cookie to its own provider's callback, so another callback never reads it", async () => {
    const w = world();
    const browser = new Browser(w.call);
    const start = await browser.fetch("/api/auth/google");
    expect(start.headers.getSetCookie().join()).toMatch(/Path=\/api\/auth\/google\/callback/);
    const state = new URL(start.headers.get("location") ?? "").searchParams.get("state");
    const redirectUri = `${origin}/api/auth/github/callback`;
    const code = w.fakes.github.issueCode({ id: 9, login: "x", name: null, emails: [] }, redirectUri);
    const elsewhere = await browser.fetch(`/api/auth/github/callback?code=${code}&state=${state}`);
    expect(elsewhere.headers.get("location")).toBe("/sign-in?error=forbidden&provider=github");
    expect(browser.cookie("hallway_session")).toBeUndefined();
  });

  it("will not start a link for an agent token (403) or someone signed out (401)", async () => {
    const w = world();
    const { browser } = await w.devSignedIn("Ann");
    const issued = (await (
      await browser.fetch("/api/me/tokens", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ label: "agent" }),
      })
    ).json()) as { secret: string };
    const asAgent = await w.call(`${origin}/api/auth/github?link=1`, { headers: { authorization: `Bearer ${issued.secret}` } });
    expect(asAgent.status).toBe(403);
    expect(asAgent.headers.getSetCookie()).toEqual([]);
    expect((await w.call(`${origin}/api/auth/github?link=1`)).status).toBe(401);
    const unlink = await w.call(`${origin}/api/me/identities/github`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${issued.secret}` },
    });
    expect(unlink.status).toBe(403);
  });

  it("refuses a link callback when someone else is signed in by then", async () => {
    const w = world();
    const { browser } = await w.devSignedIn("First Person");
    const start = await browser.fetch("/api/auth/google?link=1&returnTo=%2Fsettings");
    const state = new URL(start.headers.get("location") ?? "").searchParams.get("state");
    await browser.fetch("/api/dev/sign-in", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Second Person" }),
    });
    const redirectUri = `${origin}/api/auth/google/callback`;
    const code = w.fakes.google.issueCode({ sub: "g-z", name: "Z" }, redirectUri);
    const back = await browser.fetch(`/api/auth/google/callback?code=${code}&state=${state}`);
    expect(back.headers.get("location")).toBe("/settings?error=forbidden&provider=google");
    expect((await identitiesOf(browser)).map((identity) => identity.provider)).toEqual(["dev"]);
  });

  it("answers 404 for a provider that is not configured, and 400 for one that does not exist", async () => {
    const app = createApp<object>({
      handlers: () => ({ ...inMemoryHandlers().handlers, identity: identityHandlers(identityInMemory()) }),
      renderPng: async () => new Uint8Array(),
    });
    expect((await app.fetch(new Request(`${origin}/api/auth/google`), {})).status).toBe(404);
    expect((await app.fetch(new Request(`${origin}/api/auth/myspace`), {})).status).toBe(400);
    expect(await (await app.fetch(new Request(`${origin}/api/auth/options`), {})).json()).toEqual({
      devSignIn: false,
      providers: [],
      linkedIn: false,
    });
  });
});
