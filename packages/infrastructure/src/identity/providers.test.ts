// The Google, Microsoft and GitHub adapters against their fakes: what each
// sends, and how each decides who signed in and whether the email is proof
// (ADR 0018). LinkedIn's has its own file, from before the other three.
import { describe, expect, it } from "vitest";
import { fakeGitHub, type FakeGitHubUser } from "./fake-github.ts";
import { fakeGoogle } from "./fake-google.ts";
import { fakeMicrosoft, type FakeMicrosoftUser } from "./fake-microsoft.ts";
import { gitHubEndpoints, gitHubOAuth, maxFollowingPages } from "./github-oauth.ts";
import { googleEndpoints, googleOidc } from "./google-oidc.ts";
import { microsoftEndpoints, microsoftOidc, personalAccountsTenant } from "./microsoft-oidc.ts";

const redirectUri = "http://127.0.0.1:8787/api/auth/x/callback";

describe("googleOidc", () => {
  const ada = { sub: "1084", name: "Ada L", picture: "https://lh3.example/ada", email: "ada@gmail.com", email_verified: true };

  it("sends the browser to Google with the OIDC scopes and no secret, and reads userinfo with the token", async () => {
    const google = fakeGoogle();
    const adapter = googleOidc(google);
    const url = new URL(adapter.authorizationUrl({ state: "s", redirectUri }));
    expect(`${url.origin}${url.pathname}`).toBe(googleEndpoints.authorization);
    expect(url.searchParams.get("scope")).toBe("openid profile email");
    expect(url.toString()).not.toContain(google.clientSecret);

    expect(await adapter.identify({ code: google.issueCode(ada, redirectUri), redirectUri })).toEqual({
      subject: "1084",
      name: "Ada L",
      picture: ada.picture,
      email: ada.email,
      emailVerified: true,
    });
    expect(google.requests.map((request) => request.url)).toEqual([googleEndpoints.token, googleEndpoints.userinfo]);
  });

  it("keeps an unverified email unverified, and gives nothing for a refused code", async () => {
    const google = fakeGoogle();
    const adapter = googleOidc(google);
    const code = google.issueCode({ ...ada, email_verified: false }, redirectUri);
    expect(await adapter.identify({ code, redirectUri })).toMatchObject({ emailVerified: false });
    expect(await adapter.identify({ code, redirectUri })).toBeUndefined();
  });
});

describe("microsoftOidc", () => {
  const work: FakeMicrosoftUser = { sub: "AAAAbbb", name: "Wes Work", tid: "contoso-tenant-id", email: "wes@contoso.example" };

  async function identify(user: FakeMicrosoftUser) {
    const microsoft = fakeMicrosoft();
    return microsoftOidc(microsoft).identify({ code: microsoft.issueCode(user, redirectUri), redirectUri });
  }

  it("goes to the common tenant, so work and personal accounts both work", () => {
    const microsoft = fakeMicrosoft();
    const url = new URL(microsoftOidc(microsoft).authorizationUrl({ state: "s", redirectUri }));
    expect(`${url.origin}${url.pathname}`).toBe(microsoftEndpoints.authorization);
    expect(url.pathname).toContain("/common/");
    expect(url.searchParams.get("scope")).toBe("openid profile email");
  });

  it("does not take a work account's email as proof without xms_edov", async () => {
    expect(await identify(work)).toEqual({ subject: "AAAAbbb", name: "Wes Work", email: work.email, emailVerified: false });
    expect(await identify({ ...work, xms_edov: false })).toMatchObject({ emailVerified: false });
  });

  it("takes it as proof when the tenant verified the domain (xms_edov), in any of its spellings", async () => {
    for (const xms_edov of [true, "true", 1, "1"]) {
      expect(await identify({ ...work, xms_edov })).toMatchObject({ emailVerified: true });
    }
  });

  it("takes a personal Microsoft account's email as proof", async () => {
    expect(await identify({ ...work, tid: personalAccountsTenant, email: "pat@outlook.com" })).toMatchObject({
      email: "pat@outlook.com",
      emailVerified: true,
    });
  });

  it("has no verified email when there is no email claim", async () => {
    const { email: _, ...noEmail } = work;
    expect(await identify({ ...noEmail, tid: personalAccountsTenant })).toEqual({
      subject: work.sub,
      name: work.name,
      emailVerified: false,
    });
  });

  it("refuses an ID token for another app, or whose issuer is not its tenant's", async () => {
    expect(await identify({ ...work, aud: "someone-elses-app" })).toBeUndefined();
    expect(await identify({ ...work, iss: "https://login.microsoftonline.com/another-tenant/v2.0" })).toBeUndefined();
  });

  it("reads a name outside ASCII intact", async () => {
    expect(await identify({ ...work, name: "Zoë Ångström 山田" })).toMatchObject({ name: "Zoë Ångström 山田" });
  });
});

describe("gitHubOAuth", () => {
  const octo: FakeGitHubUser = {
    id: 583231,
    login: "octocat",
    name: "The Octocat",
    avatar_url: "https://avatars.example/583231",
    email: null,
    emails: [
      { email: "old@example.com", primary: false, verified: true },
      { email: "octo@example.com", primary: true, verified: true },
    ],
  };

  async function identify(user: FakeGitHubUser) {
    const github = fakeGitHub();
    const identity = await gitHubOAuth(github).identify({ code: github.issueCode(user, redirectUri), redirectUri });
    return { github, identity };
  }

  it("asks for read:user and user:email, the scopes #63's follows need", () => {
    const github = fakeGitHub();
    const url = new URL(gitHubOAuth(github).authorizationUrl({ state: "s", redirectUri }));
    expect(`${url.origin}${url.pathname}`).toBe(gitHubEndpoints.authorization);
    expect(url.searchParams.get("scope")).toBe("read:user user:email");
  });

  it("is the numeric id, never the login, with the primary verified email from /user/emails", async () => {
    const { identity } = await identify(octo);
    expect(identity).toEqual({
      subject: "583231",
      name: "The Octocat",
      username: "octocat",
      picture: octo.avatar_url,
      email: "octo@example.com",
      emailVerified: true,
      following: [],
    });
  });

  it("falls back to another verified email when the primary is not verified, and to none", async () => {
    const unverifiedPrimary = [
      { email: "primary@example.com", primary: true, verified: false },
      { email: "second@example.com", primary: false, verified: true },
    ];
    expect((await identify({ ...octo, emails: unverifiedPrimary })).identity).toMatchObject({
      email: "second@example.com",
      emailVerified: true,
    });
    const none = (await identify({ ...octo, emails: [{ email: "x@example.com", primary: true, verified: false }] })).identity;
    expect(none).toMatchObject({ emailVerified: false });
    expect(none).not.toHaveProperty("email");
  });

  it("uses the login when GitHub has no name", async () => {
    expect((await identify({ ...octo, name: null })).identity).toMatchObject({ name: "octocat" });
  });

  it("reads everyone followed, a page of 100 at a time, while the token is in hand", async () => {
    const following = Array.from({ length: 250 }, (_, i) => ({ id: i + 1, login: `u${i + 1}` }));
    const { github, identity } = await identify({ ...octo, following });
    expect(identity?.following).toHaveLength(250);
    expect(identity?.following?.[249]).toEqual({ id: "250", login: "u250" });
    const pages = github.requests.filter((request) => request.url.includes("/user/following"));
    expect(pages.map((request) => new URL(request.url).searchParams.get("page"))).toEqual(["1", "2", "3"]);
    expect(github.requests.every((request) => request.url === gitHubEndpoints.token || request.authorization)).toBe(true);
  });

  it(`stops after ${maxFollowingPages} pages rather than run past a Worker's subrequest limit`, async () => {
    const following = Array.from({ length: (maxFollowingPages + 2) * 100 }, (_, i) => ({ id: i + 1, login: `u${i}` }));
    const { identity } = await identify({ ...octo, following });
    expect(identity?.following).toHaveLength(maxFollowingPages * 100);
  });

  it("gives nothing for a code GitHub refuses, which it does with 200 and an error", async () => {
    const github = fakeGitHub();
    const adapter = gitHubOAuth(github);
    expect(await adapter.identify({ code: "made-up", redirectUri })).toBeUndefined();
    const code = github.issueCode(octo, redirectUri);
    expect(await adapter.identify({ code, redirectUri: "https://evil.example/cb" })).toBeUndefined();
    expect(await adapter.identify({ code, redirectUri })).toBeDefined();
    expect(await adapter.identify({ code, redirectUri })).toBeUndefined();
  });

  it("throws when GitHub's API is down, rather than pass an outage off as a refused sign-in", async () => {
    const github = fakeGitHub();
    const code = github.issueCode(octo, redirectUri);
    const failing: typeof fetch = async (input, init) => {
      const url = new Request(input, init).url;
      return url.startsWith(gitHubEndpoints.api) ? new Response("down", { status: 503 }) : github.fetch(input, init);
    };
    await expect(gitHubOAuth({ ...github, fetch: failing }).identify({ code, redirectUri })).rejects.toThrow(/503/);
  });
});
