// A fake Google: its token and OpenID userinfo endpoints, so the real adapter
// (google-oidc.ts) runs unchanged in tests and nothing calls Google.
import { fakeOAuthServer, json, type FakeProvider } from "./fake-oauth-server.ts";
import { googleEndpoints } from "./google-oidc.ts";

export interface FakeGoogleUser {
  sub: string;
  name: string;
  picture?: string;
  email?: string;
  email_verified?: boolean;
}

export type FakeGoogle = FakeProvider<FakeGoogleUser>;

export const fakeGoogle = (): FakeGoogle =>
  fakeOAuthServer("google", {
    tokenUrl: googleEndpoints.token,
    tokenExtras: () => ({ expires_in: 3599, scope: "openid profile email", id_token: "unused" }),
    api: (request, user) => (request.url === googleEndpoints.userinfo ? json(user) : undefined),
  });
