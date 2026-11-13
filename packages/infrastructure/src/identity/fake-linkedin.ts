// A fake LinkedIn: its token and userinfo endpoints, so the real adapter
// (linkedin-oidc.ts) runs unchanged in tests and nothing calls LinkedIn.
import { fakeOAuthServer, json, type FakeProvider } from "./fake-oauth-server.ts";
import { linkedInEndpoints } from "./linkedin-oidc.ts";

export interface FakeLinkedInUser {
  sub: string;
  name: string;
  picture?: string;
  email?: string;
  email_verified?: boolean;
}

export type FakeLinkedIn = FakeProvider<FakeLinkedInUser>;

export const fakeLinkedIn = (): FakeLinkedIn =>
  fakeOAuthServer("linkedin", {
    tokenUrl: linkedInEndpoints.token,
    tokenExtras: () => ({ expires_in: 5184000, scope: "openid,profile,email", id_token: "unused" }),
    api: (request, user) =>
      request.url === linkedInEndpoints.userinfo ? json({ locale: { country: "US", language: "en" }, ...user }) : undefined,
  });
