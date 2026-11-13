// Share on LinkedIn (issue #78, ADR 0026): one post, with one picture, in the
// member's name, from one consent. The authorization code is redeemed for a
// token with `w_member_social`; userinfo says whose it is; the picture goes up
// through the Images API (`initializeUpload`, then a PUT of the bytes to the
// URL it returns: LinkedIn has no synchronous upload); then the Posts API
// creates the post. The token lives in `open`'s closure only, and nothing here
// writes it anywhere: once the callback has posted, it is gone.
//
// Tested against the fake LinkedIn (fake-linkedin.ts); nothing calls LinkedIn.
import type { LinkedInMember, LinkedInPoster } from "@hallway/application";
import { getWithToken, oauthClient, type OAuthClientConfig } from "./oauth-client.ts";
import { linkedInEndpoints, type LinkedInEndpoints } from "./linkedin-oidc.ts";

/**
 * The LinkedIn API version every `/rest` call names (`LinkedIn-Version`,
 * YYYYMM). LinkedIn supports each version for a year; bump it when it ages out.
 */
export const linkedInApiVersion = "202510";

/** `openid profile` for userinfo's `sub`, the member URN the post is authored by; `w_member_social` to post. */
export const linkedInPostScope = "openid profile w_member_social";

/**
 * LinkedIn's "little text" format, which the Posts API reads commentary in:
 * these characters mean markup, and an unescaped one can drop the text after
 * it. A backslash before each makes it literal.
 */
export const littleText = (text: string) => text.replace(/[\\|{}@[\]()<>#*_~]/g, (char) => `\\${char}`);

export function linkedInPoster(config: OAuthClientConfig, endpoints: LinkedInEndpoints = linkedInEndpoints): LinkedInPoster {
  const client = oauthClient("LinkedIn", endpoints, linkedInPostScope, config);
  // The upload URL comes back from LinkedIn and is sent our bearer token, so
  // it must be LinkedIn's own (or, locally, the fake's origin).
  const uploadAllowed = (url: string) => {
    const { protocol, hostname, origin } = new URL(url);
    return origin === new URL(endpoints.images).origin || (protocol === "https:" && hostname.endsWith(".linkedin.com"));
  };

  return {
    authorizationUrl: client.authorizationUrl,

    async open(input) {
      const token = await client.redeem(input);
      if (!token) return undefined;
      const bearer = `Bearer ${token.accessToken}`;
      const info = await getWithToken<{ sub?: unknown }>(client, "LinkedIn", endpoints.userinfo, token.accessToken);
      if (typeof info.sub !== "string" || info.sub === "") return undefined;
      const author = `urn:li:person:${info.sub}`;
      const rest = { authorization: bearer, "LinkedIn-Version": linkedInApiVersion, "X-Restli-Protocol-Version": "2.0.0" };
      const failed = async (step: string, response: Response) =>
        new Error(`LinkedIn ${step} answered ${response.status}: ${(await response.text()).slice(0, 200)}`);

      const member: LinkedInMember = {
        subject: info.sub,
        async publish({ text, image, imageAlt }) {
          const initialized = await client.fetch(endpoints.images, {
            method: "POST",
            headers: { ...rest, "content-type": "application/json" },
            body: JSON.stringify({ initializeUploadRequest: { owner: author } }),
          });
          if (!initialized.ok) throw await failed("initializeUpload", initialized);
          const { value } = (await initialized.json()) as { value?: { uploadUrl?: unknown; image?: unknown } };
          if (typeof value?.uploadUrl !== "string" || typeof value.image !== "string" || !uploadAllowed(value.uploadUrl)) {
            throw new Error("LinkedIn initializeUpload gave no usable upload URL and image URN.");
          }

          const uploaded = await client.fetch(value.uploadUrl, {
            method: "PUT",
            headers: { authorization: bearer, "content-type": "image/png" },
            body: image as Uint8Array<ArrayBuffer>,
          });
          if (!uploaded.ok) throw await failed("image upload", uploaded);

          const posted = await client.fetch(endpoints.posts, {
            method: "POST",
            headers: { ...rest, "content-type": "application/json" },
            body: JSON.stringify({
              author,
              commentary: littleText(text),
              visibility: "PUBLIC",
              distribution: { feedDistribution: "MAIN_FEED", targetEntities: [], thirdPartyDistributionChannels: [] },
              content: { media: { id: value.image, altText: imageAlt } },
              lifecycleState: "PUBLISHED",
              isReshareDisabledByAuthor: false,
            }),
          });
          if (posted.status !== 201) throw await failed("posts", posted);
          // The new post's URN comes back in a header, not the body.
          const postUrn = posted.headers.get("x-restli-id");
          if (!postUrn) throw new Error("LinkedIn created the post but sent no x-restli-id.");
          return { postUrn };
        },
      };
      return member;
    },
  };
}
