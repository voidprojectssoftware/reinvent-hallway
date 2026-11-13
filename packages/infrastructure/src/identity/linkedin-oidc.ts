// Sign In with LinkedIn using OpenID Connect (docs/discovery/linkedin.md), as
// the application's IdentityProvider. Authorization code flow for a
// confidential client: the secret goes server to server in the token request
// and nowhere else.
//
// Identity comes from the userinfo endpoint, called with the access token we
// just redeemed over TLS from LinkedIn itself, rather than from the ID token.
// That gives the same claims without a JWKS fetch and JWT signature check to
// get wrong; the ID token would matter if it came to us through the browser,
// and it does not.
//
// No PKCE: LinkedIn offers it only to native apps that ask for it, and its
// web flow is the confidential client above. The callback is bound to the
// browser that started it by `state` and a short-lived cookie (apps/api).
import type { IdentityProvider, VerifiedIdentity } from "@hallway/application";

export const linkedInEndpoints = {
  authorization: "https://www.linkedin.com/oauth/v2/authorization",
  token: "https://www.linkedin.com/oauth/v2/accessToken",
  userinfo: "https://api.linkedin.com/v2/userinfo",
} as const;

export interface LinkedInConfig {
  clientId: string;
  clientSecret: string;
  /** Tests pass a fake provider here; the Worker uses the global fetch. */
  fetch?: typeof fetch;
}

interface UserInfo {
  sub?: unknown;
  name?: unknown;
  picture?: unknown;
  email?: unknown;
  email_verified?: unknown;
}

export function linkedInOidc(config: LinkedInConfig): IdentityProvider {
  const fetcher = config.fetch ?? ((input, init) => fetch(input, init));
  return {
    authorizationUrl({ state, redirectUri }) {
      const url = new URL(linkedInEndpoints.authorization);
      url.search = new URLSearchParams({
        response_type: "code",
        client_id: config.clientId,
        redirect_uri: redirectUri,
        state,
        scope: "openid profile email",
      }).toString();
      return url.toString();
    },

    async identify({ code, redirectUri }) {
      const tokenResponse = await fetcher(linkedInEndpoints.token, {
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
      // A 4xx is LinkedIn refusing the code (expired, reused, wrong redirect);
      // anything else unexpected is an outage and should fail loudly.
      if (tokenResponse.status >= 400 && tokenResponse.status < 500) return undefined;
      if (!tokenResponse.ok) throw new Error(`LinkedIn token endpoint answered ${tokenResponse.status}.`);
      const { access_token: accessToken } = (await tokenResponse.json()) as { access_token?: unknown };
      if (typeof accessToken !== "string") return undefined;

      const userinfoResponse = await fetcher(linkedInEndpoints.userinfo, {
        headers: { authorization: `Bearer ${accessToken}`, accept: "application/json" },
      });
      if (!userinfoResponse.ok) throw new Error(`LinkedIn userinfo answered ${userinfoResponse.status}.`);
      return toIdentity((await userinfoResponse.json()) as UserInfo);
    },
  };
}

function toIdentity(info: UserInfo): VerifiedIdentity | undefined {
  if (typeof info.sub !== "string" || info.sub === "" || typeof info.name !== "string") return undefined;
  return {
    subject: info.sub,
    name: info.name,
    ...(typeof info.picture === "string" ? { picture: info.picture } : {}),
    ...(typeof info.email === "string" ? { email: info.email } : {}),
    // Only true (or "true", as some OIDC providers send it) counts; absent,
    // false or anything else is unverified.
    emailVerified: info.email_verified === true || info.email_verified === "true",
  };
}
