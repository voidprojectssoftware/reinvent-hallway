// Sign In with LinkedIn using OpenID Connect (docs/discovery/linkedin.md).
// LinkedIn offers PKCE only to native apps; ours is a confidential client.
import type { IdentityProvider } from "@hallway/application";
import type { OAuthClientConfig } from "./oauth-client.ts";
import { oidcUserinfoProvider } from "./oidc-userinfo.ts";

export const linkedInEndpoints = {
  authorization: "https://www.linkedin.com/oauth/v2/authorization",
  token: "https://www.linkedin.com/oauth/v2/accessToken",
  userinfo: "https://api.linkedin.com/v2/userinfo",
  // Share on LinkedIn (ADR 0026): the Images API's upload, then the Posts API.
  images: "https://api.linkedin.com/rest/images?action=initializeUpload",
  posts: "https://api.linkedin.com/rest/posts",
};
export type LinkedInEndpoints = typeof linkedInEndpoints;

/**
 * Every LinkedIn address moved onto one origin: the fake LinkedIn server
 * `npm run fake:linkedin` runs for driving the app locally (ADR 0026). The
 * Worker uses it only with dev sign-in on (apps/api/src/index.ts).
 */
export function linkedInEndpointsAt(origin: string): LinkedInEndpoints {
  const moved = (url: string) => {
    const { pathname, search } = new URL(url);
    return new URL(`${pathname}${search}`, origin).href;
  };
  return {
    authorization: moved(linkedInEndpoints.authorization),
    token: moved(linkedInEndpoints.token),
    userinfo: moved(linkedInEndpoints.userinfo),
    images: moved(linkedInEndpoints.images),
    posts: moved(linkedInEndpoints.posts),
  };
}

export const linkedInOidc = (config: OAuthClientConfig, endpoints: LinkedInEndpoints = linkedInEndpoints): IdentityProvider =>
  oidcUserinfoProvider("LinkedIn", endpoints, config);
