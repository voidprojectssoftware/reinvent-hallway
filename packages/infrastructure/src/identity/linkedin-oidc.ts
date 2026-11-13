// Sign In with LinkedIn using OpenID Connect (docs/discovery/linkedin.md).
// LinkedIn offers PKCE only to native apps; ours is a confidential client.
import type { IdentityProvider } from "@hallway/application";
import type { OAuthClientConfig } from "./oauth-client.ts";
import { oidcUserinfoProvider } from "./oidc-userinfo.ts";

export const linkedInEndpoints = {
  authorization: "https://www.linkedin.com/oauth/v2/authorization",
  token: "https://www.linkedin.com/oauth/v2/accessToken",
  userinfo: "https://api.linkedin.com/v2/userinfo",
} as const;

export const linkedInOidc = (config: OAuthClientConfig): IdentityProvider =>
  oidcUserinfoProvider("LinkedIn", linkedInEndpoints, config);
