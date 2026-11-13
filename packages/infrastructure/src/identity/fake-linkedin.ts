// A fake LinkedIn: the token and userinfo endpoints as a `fetch`, so the real
// adapter (linkedin-oidc.ts) runs unchanged in tests and nothing calls
// LinkedIn. It plays the provider strictly: a code is good once, only for the
// redirect URI and client it was issued to, and only with the right secret.
import { linkedInEndpoints } from "./linkedin-oidc.ts";

export interface FakeLinkedInUser {
  sub: string;
  name: string;
  picture?: string;
  email?: string;
  email_verified?: boolean;
}

export interface FakeLinkedIn {
  clientId: string;
  clientSecret: string;
  fetch: typeof fetch;
  /** What LinkedIn would put on the callback after this user consents. */
  issueCode(user: FakeLinkedInUser, redirectUri: string): string;
  /** Every request the adapter made, for asserting on what it sent. */
  requests: { url: string; body?: string; authorization?: string }[];
}

export function fakeLinkedIn(): FakeLinkedIn {
  const clientId = "fake-client-id";
  const clientSecret = "fake-client-secret";
  const codes = new Map<string, { user: FakeLinkedInUser; redirectUri: string }>();
  const accessTokens = new Map<string, FakeLinkedInUser>();
  const requests: FakeLinkedIn["requests"] = [];
  let next = 0;

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

  const fakeFetch = async (input: string | URL | Request, init?: RequestInit) => {
    const request = new Request(input, init);
    const body = request.method === "POST" ? await request.text() : undefined;
    const authorization = request.headers.get("authorization") ?? undefined;
    requests.push({ url: request.url, ...(body !== undefined && { body }), ...(authorization && { authorization }) });

    if (request.url === linkedInEndpoints.token && request.method === "POST") {
      const form = new URLSearchParams(body);
      const issued = codes.get(form.get("code") ?? "");
      if (form.get("client_id") !== clientId || form.get("client_secret") !== clientSecret) {
        return json({ error: "invalid_client" }, 401);
      }
      if (!issued || issued.redirectUri !== form.get("redirect_uri") || form.get("grant_type") !== "authorization_code") {
        return json({ error: "invalid_request", error_description: "Unable to retrieve access token" }, 400);
      }
      codes.delete(form.get("code") ?? "");
      const accessToken = `access-${(next += 1)}`;
      accessTokens.set(accessToken, issued.user);
      return json({ access_token: accessToken, expires_in: 5184000, scope: "openid,profile,email", id_token: "unused" });
    }

    if (request.url === linkedInEndpoints.userinfo) {
      const user = accessTokens.get(authorization?.replace(/^Bearer /, "") ?? "");
      return user ? json({ locale: { country: "US", language: "en" }, ...user }) : json({ message: "Invalid access token" }, 401);
    }

    return json({ message: `The fake LinkedIn has nothing at ${request.method} ${request.url}` }, 404);
  };

  return {
    clientId,
    clientSecret,
    fetch: fakeFetch as typeof fetch,
    requests,
    issueCode(user, redirectUri) {
      const code = `code-${(next += 1)}`;
      codes.set(code, { user, redirectUri });
      return code;
    },
  };
}
