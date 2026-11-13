// Sign in with Google using OpenID Connect. Google's userinfo states
// `email_verified` itself, so its email is believed only when that is true.
import type { IdentityProvider } from "@hallway/application";
import type { OAuthClientConfig } from "./oauth-client.ts";
import { oidcUserinfoProvider } from "./oidc-userinfo.ts";

export const googleEndpoints = {
  authorization: "https://accounts.google.com/o/oauth2/v2/auth",
  token: "https://oauth2.googleapis.com/token",
  userinfo: "https://openidconnect.googleapis.com/v1/userinfo",
} as const;

export const googleOidc = (config: OAuthClientConfig): IdentityProvider =>
  oidcUserinfoProvider("Google", googleEndpoints, config);
