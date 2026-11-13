// A fake Microsoft identity platform: its token endpoint, answering with an
// ID token whose claims are the user's, so the real adapter
// (microsoft-oidc.ts) runs unchanged in tests and nothing calls Microsoft.
// The ID token is unsigned, which is all the adapter reads (it trusts TLS).
import { fakeOAuthServer, type FakeProvider } from "./fake-oauth-server.ts";
import { microsoftEndpoints } from "./microsoft-oidc.ts";

export interface FakeMicrosoftUser {
  sub: string;
  name: string;
  /** The tenant; `personalAccountsTenant` for an outlook.com account. */
  tid: string;
  email?: string;
  xms_edov?: boolean | string | number;
  /** Overrides, to prove the adapter refuses a token for another app or issuer. */
  aud?: string;
  iss?: string;
}

export type FakeMicrosoft = FakeProvider<FakeMicrosoftUser>;

const base64url = (text: string) =>
  btoa(String.fromCharCode(...new TextEncoder().encode(text))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** An unsigned JWT holding these claims. */
export const unsignedJwt = (claims: Record<string, unknown>) =>
  `${base64url(JSON.stringify({ alg: "none", typ: "JWT" }))}.${base64url(JSON.stringify(claims))}.`;

export const fakeMicrosoft = (): FakeMicrosoft =>
  fakeOAuthServer("microsoft", {
    tokenUrl: microsoftEndpoints.token,
    tokenExtras: ({ aud, iss, ...user }, clientId) => ({
      expires_in: 3599,
      scope: "openid profile email",
      id_token: unsignedJwt({
        ver: "2.0",
        aud: aud ?? clientId,
        iss: iss ?? `https://login.microsoftonline.com/${user.tid}/v2.0`,
        ...user,
      }),
    }),
    api: () => undefined,
  });
