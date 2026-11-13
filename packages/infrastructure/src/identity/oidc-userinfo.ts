// An OpenID Connect provider that says who signed in through its userinfo
// endpoint: LinkedIn and Google (ADR 0018).
//
// Identity comes from userinfo, called with the access token we just redeemed
// over TLS from the provider itself, rather than from the ID token (ADR 0008).
// That gives the same claims without a JWKS fetch and JWT signature check to
// get wrong; the ID token would matter if it came to us through the browser,
// and it does not.
import type { IdentityProvider, VerifiedIdentity } from "@hallway/application";
import { claimIsTrue, getWithToken, oauthClient, type OAuthClientConfig, type OAuthEndpoints } from "./oauth-client.ts";

export interface UserinfoEndpoints extends OAuthEndpoints {
  userinfo: string;
}

interface UserInfo {
  sub?: unknown;
  name?: unknown;
  picture?: unknown;
  email?: unknown;
  email_verified?: unknown;
}

export function oidcUserinfoProvider(
  name: string,
  endpoints: UserinfoEndpoints,
  config: OAuthClientConfig,
): IdentityProvider {
  const client = oauthClient(name, endpoints, "openid profile email", config);
  return {
    authorizationUrl: client.authorizationUrl,
    async identify(input) {
      const token = await client.redeem(input);
      if (!token) return undefined;
      return toIdentity(await getWithToken<UserInfo>(client, name, endpoints.userinfo, token.accessToken));
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
    emailVerified: claimIsTrue(info.email_verified),
  };
}
