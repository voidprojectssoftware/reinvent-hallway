// Sign in with Microsoft (Entra ID, the `common` tenant, so work, school and
// personal accounts all work) using OpenID Connect.
//
// Identity comes from the ID token here, not userinfo: Microsoft's userinfo
// leaves out `tid` and `xms_edov`, the two claims that say whether the email
// is proof (ADR 0018). The ID token reaches us in the token response, server
// to server over TLS from login.microsoftonline.com, so as with userinfo
// elsewhere, TLS is what vouches for it (OIDC Core 3.1.3.7) and no JWKS
// signature check is done. Its audience and issuer are still checked, so a
// token meant for another app or naming another tenant is refused.
//
// Microsoft's `email` is not proof: a tenant admin can set any address. It is
// verified only when `xms_edov` (email domain owner verified, an optional
// claim the app registration must ask for) is true, or the account is a
// personal Microsoft account, whose tenant id is fixed.
import type { IdentityProvider, VerifiedIdentity } from "@hallway/application";
import { claimIsTrue, oauthClient, type OAuthClientConfig } from "./oauth-client.ts";

export const microsoftEndpoints = {
  authorization: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
  token: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
} as const;

/** The tenant every personal Microsoft account (outlook.com, live.com) signs in under. */
export const personalAccountsTenant = "9188040d-6c67-4c5b-b112-36a304b66dad";

interface IdTokenClaims {
  aud?: unknown;
  iss?: unknown;
  tid?: unknown;
  sub?: unknown;
  name?: unknown;
  email?: unknown;
  xms_edov?: unknown;
}

export function microsoftOidc(config: OAuthClientConfig): IdentityProvider {
  const client = oauthClient("Microsoft", microsoftEndpoints, "openid profile email", config);
  return {
    authorizationUrl: client.authorizationUrl,
    async identify(input) {
      const token = await client.redeem(input);
      if (!token?.idToken) return undefined;
      const claims = payloadOf(token.idToken);
      return claims && toIdentity(claims, config.clientId);
    },
  };
}

/** The JWT's middle part, or undefined when it is not one. */
function payloadOf(jwt: string): IdTokenClaims | undefined {
  const [, payload] = jwt.split(".");
  if (!payload) return undefined;
  try {
    const json = new TextDecoder().decode(Uint8Array.from(atob(payload.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0)));
    const claims: unknown = JSON.parse(json);
    return typeof claims === "object" && claims !== null ? (claims as IdTokenClaims) : undefined;
  } catch {
    // Not base64url JSON: not an ID token we can read, so no one signed in.
    return undefined;
  }
}

function toIdentity(claims: IdTokenClaims, clientId: string): VerifiedIdentity | undefined {
  const { aud, iss, tid, sub, name } = claims;
  if (aud !== clientId || typeof tid !== "string") return undefined;
  if (iss !== `https://login.microsoftonline.com/${tid}/v2.0`) return undefined;
  if (typeof sub !== "string" || sub === "" || typeof name !== "string") return undefined;
  const email = typeof claims.email === "string" ? claims.email : undefined;
  // xms_edov arrives as a boolean or, in some tenants, as "1" or 1.
  const domainOwnerVerified = claimIsTrue(claims.xms_edov) || claims.xms_edov === 1 || claims.xms_edov === "1";
  return {
    subject: sub,
    name,
    ...(email !== undefined && { email }),
    emailVerified: email !== undefined && (tid === personalAccountsTenant || domainOwnerVerified),
  };
}
