// The LinkedIn adapter against the fake provider: no real LinkedIn call.
import { describe, expect, it } from "vitest";
import { fakeLinkedIn } from "./fake-linkedin.ts";
import { linkedInEndpoints, linkedInOidc } from "./linkedin-oidc.ts";

const redirectUri = "http://127.0.0.1:8787/api/auth/linkedin/callback";
const jane = {
  sub: "782bbtaQ",
  name: "Jane Doe",
  picture: "https://media.licdn.com/jane.jpg",
  email: "jane@example.com",
  email_verified: true,
};

function adapter() {
  const linkedIn = fakeLinkedIn();
  return { linkedIn, oidc: linkedInOidc(linkedIn) };
}

describe("linkedInOidc", () => {
  it("sends the browser to LinkedIn with the OIDC scopes, its state and the redirect URI, and no secret", () => {
    const { linkedIn, oidc } = adapter();
    const url = new URL(oidc.authorizationUrl({ state: "s-123", redirectUri }));
    expect(`${url.origin}${url.pathname}`).toBe(linkedInEndpoints.authorization);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      response_type: "code",
      client_id: linkedIn.clientId,
      redirect_uri: redirectUri,
      state: "s-123",
      scope: "openid profile email",
    });
    expect(url.toString()).not.toContain(linkedIn.clientSecret);
  });

  it("redeems the code with the secret server side, then reads userinfo", async () => {
    const { linkedIn, oidc } = adapter();
    const code = linkedIn.issueCode(jane, redirectUri);
    expect(await oidc.identify({ code, redirectUri })).toEqual({
      subject: jane.sub,
      name: jane.name,
      picture: jane.picture,
      email: jane.email,
      emailVerified: true,
    });
    const [token, userinfo] = linkedIn.requests;
    expect(token?.url).toBe(linkedInEndpoints.token);
    expect(Object.fromEntries(new URLSearchParams(token?.body))).toEqual({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: linkedIn.clientId,
      client_secret: linkedIn.clientSecret,
    });
    expect(userinfo?.authorization).toMatch(/^Bearer access-/);
  });

  it("reports an email LinkedIn did not verify as unverified", async () => {
    const { linkedIn, oidc } = adapter();
    const code = linkedIn.issueCode({ ...jane, email_verified: false }, redirectUri);
    expect(await oidc.identify({ code, redirectUri })).toMatchObject({ email: jane.email, emailVerified: false });
    const absent = linkedIn.issueCode({ sub: "x1", name: "No Claim", email: "x@example.com" }, redirectUri);
    expect(await oidc.identify({ code: absent, redirectUri })).toMatchObject({ emailVerified: false });
  });

  it("gives nothing for a code LinkedIn refuses: unknown, reused, or for another redirect URI", async () => {
    const { linkedIn, oidc } = adapter();
    expect(await oidc.identify({ code: "made-up", redirectUri })).toBeUndefined();
    const code = linkedIn.issueCode(jane, redirectUri);
    expect(await oidc.identify({ code, redirectUri: "https://evil.example/cb" })).toBeUndefined();
    expect(await oidc.identify({ code, redirectUri })).toBeDefined();
    expect(await oidc.identify({ code, redirectUri })).toBeUndefined();
  });

  it("gives nothing with the wrong client secret", async () => {
    const linkedIn = fakeLinkedIn();
    const oidc = linkedInOidc({ ...linkedIn, clientSecret: "wrong" });
    expect(await oidc.identify({ code: linkedIn.issueCode(jane, redirectUri), redirectUri })).toBeUndefined();
  });

  it("throws when LinkedIn is down, rather than pass an outage off as a refused sign-in", async () => {
    const oidc = linkedInOidc({
      clientId: "id",
      clientSecret: "secret",
      fetch: async () => new Response("bad gateway", { status: 502 }),
    });
    await expect(oidc.identify({ code: "c", redirectUri })).rejects.toThrow(/502/);
  });
});
