// The half of every sign-in provider that is the same (ADR 0018): the
// authorization code flow for a confidential client. The browser goes to the
// provider with our client id, state and redirect URI; the code comes back and
// is redeemed server to server with the secret, which goes nowhere else. Each
// adapter (Google, Microsoft, LinkedIn, GitHub) adds only how it learns who
// signed in from the token it got.
//
// No PKCE: each is a confidential client whose secret stays server side, and
// the callback is bound to the browser that started it by `state` and a
// short-lived cookie (ADR 0008, apps/api).

export interface OAuthClientConfig {
  clientId: string;
  clientSecret: string;
  /** Tests pass a fake provider here; the Worker uses the global fetch. */
  fetch?: typeof fetch;
}

export interface OAuthEndpoints {
  authorization: string;
  token: string;
}

/** The token endpoint's answer, as far as any adapter reads it. */
export interface TokenResponse {
  accessToken: string;
  /** OIDC providers send it; Microsoft's adapter reads it. */
  idToken?: string;
}

export interface OAuthClient {
  fetch: typeof fetch;
  authorizationUrl(input: { state: string; redirectUri: string }): string;
  /** Undefined when the provider refuses the code; throws when the provider is down. */
  redeem(input: { code: string; redirectUri: string }): Promise<TokenResponse | undefined>;
}

export function oauthClient(
  name: string,
  endpoints: OAuthEndpoints,
  scope: string,
  config: OAuthClientConfig,
): OAuthClient {
  const fetcher = config.fetch ?? ((input, init) => fetch(input, init));
  return {
    fetch: fetcher,
    authorizationUrl({ state, redirectUri }) {
      const url = new URL(endpoints.authorization);
      url.search = new URLSearchParams({
        response_type: "code",
        client_id: config.clientId,
        redirect_uri: redirectUri,
        state,
        scope,
      }).toString();
      return url.toString();
    },

    async redeem({ code, redirectUri }) {
      const response = await fetcher(endpoints.token, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          redirect_uri: redirectUri,
          client_id: config.clientId,
          client_secret: config.clientSecret,
        }).toString(),
      });
      // A 4xx is the provider refusing the code (expired, reused, wrong
      // redirect); anything else unexpected is an outage and should fail loudly.
      if (response.status >= 400 && response.status < 500) return undefined;
      if (!response.ok) throw new Error(`${name} token endpoint answered ${response.status}.`);
      // GitHub refuses a code with 200 and an `error` field, so a missing
      // access token is a refusal too, whatever the status.
      const body = (await response.json()) as { access_token?: unknown; id_token?: unknown };
      if (typeof body.access_token !== "string") return undefined;
      return {
        accessToken: body.access_token,
        ...(typeof body.id_token === "string" && { idToken: body.id_token }),
      };
    },
  };
}

/** A GET with the user's access token, as JSON; throws on anything but 2xx. */
export async function getWithToken<T>(
  client: OAuthClient,
  name: string,
  url: string,
  accessToken: string,
  headers: Record<string, string> = {},
): Promise<T> {
  const response = await client.fetch(url, {
    headers: { authorization: `Bearer ${accessToken}`, accept: "application/json", ...headers },
  });
  if (!response.ok) throw new Error(`${name} ${new URL(url).pathname} answered ${response.status}.`);
  return (await response.json()) as T;
}

/** Only true (or "true", as some OIDC providers send it) counts; absent, false or anything else does not. */
export const claimIsTrue = (claim: unknown) => claim === true || claim === "true";
