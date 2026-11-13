// The Share on LinkedIn adapter against the fake LinkedIn: no real LinkedIn call.
import { describe, expect, it } from "vitest";
import { fakeLinkedIn } from "./fake-linkedin.ts";
import { linkedInEndpoints } from "./linkedin-oidc.ts";
import { linkedInApiVersion, linkedInPoster, littleText } from "./linkedin-posts.ts";

const redirectUri = "http://127.0.0.1:8787/api/me/share/post/callback";
const jane = { sub: "782bbtaQ", name: "Jane Doe" };
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);

function adapter() {
  const linkedIn = fakeLinkedIn();
  return { linkedIn, poster: linkedInPoster(linkedIn) };
}

describe("linkedInPoster", () => {
  it("asks LinkedIn for w_member_social, with the state and redirect URI, and no secret", () => {
    const { linkedIn, poster } = adapter();
    const url = new URL(poster.authorizationUrl({ state: "s-1", redirectUri }));
    expect(`${url.origin}${url.pathname}`).toBe(linkedInEndpoints.authorization);
    expect(url.searchParams.get("scope")).toBe("openid profile w_member_social");
    expect(url.searchParams.get("state")).toBe("s-1");
    expect(url.toString()).not.toContain(linkedIn.clientSecret);
  });

  it("uploads the picture, then posts it as the member who agreed, and returns the post's URN", async () => {
    const { linkedIn, poster } = adapter();
    const member = await poster.open({ code: linkedIn.issueCode(jane, redirectUri), redirectUri });
    expect(member?.subject).toBe(jane.sub);
    const { postUrn } = await member!.publish({ text: "Going to AIM3315 (Venetian) #reInvent", image: png, imageAlt: "Jane's week" });

    expect(linkedIn.images).toEqual([expect.objectContaining({ owner: "urn:li:person:782bbtaQ", bytes: png })]);
    expect(linkedIn.posts).toEqual([
      expect.objectContaining({
        urn: postUrn,
        author: "urn:li:person:782bbtaQ",
        commentary: "Going to AIM3315 \\(Venetian\\) \\#reInvent",
        imageUrn: linkedIn.images[0]!.urn,
        altText: "Jane's week",
      }),
    ]);
    expect(linkedIn.posts[0]!.body).toMatchObject({ visibility: "PUBLIC", lifecycleState: "PUBLISHED" });
    const rest = linkedIn.requests.filter((request) => request.url.includes("/rest/"));
    expect(rest).toHaveLength(2);
  });

  it("is undefined when LinkedIn refuses the code, and throws when a call fails, so nothing half-posts quietly", async () => {
    const { linkedIn, poster } = adapter();
    expect(await poster.open({ code: "never-issued", redirectUri })).toBeUndefined();
    const member = await poster.open({ code: linkedIn.issueCode(jane, redirectUri), redirectUri });
    linkedIn.images.push({ urn: "x", owner: "y", uploadUrl: "z" });
    await expect(member!.publish({ text: "x".repeat(3001), image: png, imageAlt: "" })).rejects.toThrow(/posts answered 422/);
  });

  it("sends its token to no upload URL but LinkedIn's own", async () => {
    const linkedIn = fakeLinkedIn();
    const evil: typeof fetch = async (input, init) => {
      const request = new Request(input, init);
      if (request.url === linkedInEndpoints.images) {
        return Response.json({ value: { uploadUrl: "https://attacker.example/upload", image: "urn:li:image:1" } });
      }
      return linkedIn.fetch(input, init);
    };
    const poster = linkedInPoster({ ...linkedIn, fetch: evil });
    const member = await poster.open({ code: linkedIn.issueCode(jane, redirectUri), redirectUri });
    await expect(member!.publish({ text: "hi", image: png, imageAlt: "" })).rejects.toThrow(/no usable upload URL/);
  });

  it("names the API version LinkedIn asks for", () => {
    expect(linkedInApiVersion).toMatch(/^\d{6}$/);
    expect(littleText("a_b*c~d")).toBe("a\\_b\\*c\\~d");
  });
});
