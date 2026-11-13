// A fake LinkedIn: its token and userinfo endpoints, and the Images and Posts
// APIs Share on LinkedIn uses (ADR 0026), so the real adapters
// (linkedin-oidc.ts, linkedin-posts.ts) run unchanged in tests and nothing
// calls LinkedIn. It keeps what was uploaded and posted for tests to look at,
// and refuses what LinkedIn refuses: a `/rest` call without `LinkedIn-Version`
// or Rest.li 2.0, a post or upload owned by anyone but the token's member, a
// post naming an image never uploaded.
import { fakeOAuthServer, json, type FakeProvider } from "./fake-oauth-server.ts";
import { linkedInEndpoints } from "./linkedin-oidc.ts";

export interface FakeLinkedInUser {
  sub: string;
  name: string;
  picture?: string;
  email?: string;
  email_verified?: boolean;
}

export interface FakeLinkedInPost {
  urn: string;
  author: string;
  /** As sent: LinkedIn's little text format, reserved characters escaped. */
  commentary: string;
  imageUrn: string;
  altText?: string;
  body: Record<string, unknown>;
}

export interface FakeLinkedInImage {
  urn: string;
  owner: string;
  uploadUrl: string;
  /** The bytes PUT to the upload URL; absent until then. */
  bytes?: Uint8Array;
}

export type FakeLinkedIn = FakeProvider<FakeLinkedInUser> & {
  images: FakeLinkedInImage[];
  posts: FakeLinkedInPost[];
};

/**
 * `uploadBase` is where the fake tells an adapter to PUT an image: on
 * LinkedIn's own host by default, as the real one does; the local fake server
 * moves it onto its own origin, so nothing is ever sent to LinkedIn.
 */
export function fakeLinkedIn({ uploadBase = "https://www.linkedin.com/dms-uploads/fake/" } = {}): FakeLinkedIn {
  const images: FakeLinkedInImage[] = [];
  const posts: FakeLinkedInPost[] = [];
  const rest = (request: Request) =>
    request.headers.get("linkedin-version")?.match(/^\d{6}$/) && request.headers.get("x-restli-protocol-version") === "2.0.0";

  const server = fakeOAuthServer<FakeLinkedInUser>("linkedin", {
    tokenUrl: linkedInEndpoints.token,
    tokenExtras: () => ({ expires_in: 5184000, scope: "openid,profile,email", id_token: "unused" }),
    api: async (request, user) => {
      const member = `urn:li:person:${user.sub}`;
      if (request.url === linkedInEndpoints.userinfo) {
        return json({ locale: { country: "US", language: "en" }, ...user });
      }
      if (request.url === linkedInEndpoints.images && request.method === "POST") {
        if (!rest(request)) return json({ message: "LinkedIn-Version and X-Restli-Protocol-Version 2.0.0 are required" }, 400);
        const body = (await request.json()) as { initializeUploadRequest?: { owner?: string } };
        if (body.initializeUploadRequest?.owner !== member) return json({ message: "Owner is not the member" }, 403);
        const n = images.length + 1;
        const image: FakeLinkedInImage = { urn: `urn:li:image:fake-${n}`, owner: member, uploadUrl: `${uploadBase}${n}` };
        images.push(image);
        return json({ value: { uploadUrlExpiresAt: Date.now() + 3_600_000, uploadUrl: image.uploadUrl, image: image.urn } });
      }
      const pending = images.find((image) => image.uploadUrl === request.url);
      if (pending && request.method === "PUT") {
        if (pending.owner !== member) return json({ message: "Not your upload" }, 403);
        pending.bytes = new Uint8Array(await request.arrayBuffer());
        return new Response(null, { status: 201 });
      }
      if (request.url === linkedInEndpoints.posts && request.method === "POST") {
        if (!rest(request)) return json({ message: "LinkedIn-Version and X-Restli-Protocol-Version 2.0.0 are required" }, 400);
        const body = (await request.json()) as {
          author?: string;
          commentary?: string;
          content?: { media?: { id?: string; altText?: string } };
        };
        if (body.author !== member) return json({ message: "Author is not the member" }, 403);
        const image = images.find((candidate) => candidate.urn === body.content?.media?.id);
        if (!image?.bytes) return json({ message: "No uploaded image with that URN" }, 400);
        if (typeof body.commentary !== "string" || body.commentary.length > 3000) {
          return json({ message: "commentary must be text of at most 3000 characters" }, 422);
        }
        const urn = `urn:li:share:${7000000000000000000 + posts.length + 1}`;
        posts.push({
          urn,
          author: member,
          commentary: body.commentary,
          imageUrn: image.urn,
          ...(body.content?.media?.altText !== undefined && { altText: body.content.media.altText }),
          body,
        });
        return new Response(null, { status: 201, headers: { "x-restli-id": urn } });
      }
      return undefined;
    },
  });
  return { ...server, images, posts };
}
