// What every fake sign-in provider shares: a token endpoint that plays the
// provider strictly (a code is good once, only for the redirect URI and client
// it was issued to, and only with the right secret), as a `fetch`, so the real
// adapter runs unchanged in tests and nothing calls a real provider. Each fake
// (fake-google.ts, fake-microsoft.ts, fake-linkedin.ts, fake-github.ts) adds
// the endpoints its provider says who signed in through.

export interface FakeProvider<User> {
  clientId: string;
  clientSecret: string;
  fetch: typeof fetch;
  /** What the provider would put on the callback after this user consents. */
  issueCode(user: User, redirectUri: string): string;
  /** Every request the adapter made, for asserting on what it sent. */
  requests: { url: string; body?: string; authorization?: string }[];
}

export interface FakeProviderSpec<User> {
  tokenUrl: string;
  /** How this provider refuses a code: most answer 400, GitHub answers 200 with an `error`. */
  refusalStatus?: number;
  /** Extra fields of a successful token response (an OIDC provider's `id_token`). */
  tokenExtras?: (user: User, clientId: string) => Record<string, unknown>;
  /** Answers an API request made with a good access token; undefined for "nothing here". */
  api: (request: Request, user: User) => Response | Promise<Response | undefined> | undefined;
}

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

export function fakeOAuthServer<User>(name: string, spec: FakeProviderSpec<User>): FakeProvider<User> {
  const clientId = `fake-${name}-client-id`;
  const clientSecret = `fake-${name}-client-secret`;
  const codes = new Map<string, { user: User; redirectUri: string }>();
  const accessTokens = new Map<string, User>();
  const requests: FakeProvider<User>["requests"] = [];
  let next = 0;

  const fakeFetch = async (input: string | URL | Request, init?: RequestInit) => {
    const request = new Request(input, init);
    const body = request.method === "POST" ? await request.clone().text() : undefined;
    const authorization = request.headers.get("authorization") ?? undefined;
    requests.push({ url: request.url, ...(body !== undefined && { body }), ...(authorization && { authorization }) });

    if (request.url === spec.tokenUrl && request.method === "POST") {
      const form = new URLSearchParams(body);
      const issued = codes.get(form.get("code") ?? "");
      if (form.get("client_id") !== clientId || form.get("client_secret") !== clientSecret) {
        return json({ error: "invalid_client" }, 401);
      }
      if (!issued || issued.redirectUri !== form.get("redirect_uri") || form.get("grant_type") !== "authorization_code") {
        return json({ error: "invalid_grant", error_description: "Bad or used code" }, spec.refusalStatus ?? 400);
      }
      codes.delete(form.get("code") ?? "");
      const accessToken = `${name}-access-${(next += 1)}`;
      accessTokens.set(accessToken, issued.user);
      return json({ access_token: accessToken, token_type: "Bearer", ...spec.tokenExtras?.(issued.user, clientId) });
    }

    const user = accessTokens.get(authorization?.replace(/^Bearer /, "") ?? "");
    if (!user) return json({ message: "Bad credentials" }, 401);
    return (await spec.api(request, user)) ?? json({ message: `The fake ${name} has nothing at ${request.method} ${request.url}` }, 404);
  };

  return {
    clientId,
    clientSecret,
    fetch: fakeFetch as typeof fetch,
    requests,
    issueCode(user, redirectUri) {
      const code = `${name}-code-${(next += 1)}`;
      codes.set(code, { user, redirectUri });
      return code;
    },
  };
}
