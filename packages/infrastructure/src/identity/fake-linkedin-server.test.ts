// The local fake LinkedIn over real HTTP, as the Worker under `npm run dev`
// reaches it: consent in a browser, then the real adapter posts through it.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startFakeLinkedInServer, type FakeLinkedInServer } from "./fake-linkedin-server.ts";
import { linkedInEndpointsAt } from "./linkedin-oidc.ts";
import { linkedInPoster } from "./linkedin-posts.ts";

let server: FakeLinkedInServer;
beforeAll(async () => {
  server = await startFakeLinkedInServer();
});
afterAll(async () => {
  await server.close();
});

describe("the fake LinkedIn server", () => {
  it("shows a consent page, sends the browser back with a code, and shows the post the adapter made", async () => {
    const { linkedIn, origin } = server;
    const poster = linkedInPoster({ clientId: linkedIn.clientId, clientSecret: linkedIn.clientSecret }, linkedInEndpointsAt(origin));
    const redirectUri = "http://127.0.0.1:1/api/me/share/post/callback";
    const authorization = new URL(poster.authorizationUrl({ state: "st", redirectUri }));
    expect(authorization.origin).toBe(origin);
    const consent = await fetch(authorization);
    expect(await consent.text()).toContain("w_member_social");

    const allowed = await fetch(`${origin}/fake/consent?redirect_uri=${encodeURIComponent(redirectUri)}&state=st&decision=allow&name=Jane&sub=li-jane`, {
      redirect: "manual",
    });
    const back = new URL(allowed.headers.get("location") ?? "");
    expect(back.searchParams.get("state")).toBe("st");

    const member = await poster.open({ code: back.searchParams.get("code") ?? "", redirectUri });
    const { postUrn } = await member!.publish({ text: "Hello (Vegas)", image: new Uint8Array([1, 2, 3]), imageAlt: "a week" });
    expect(linkedIn.images[0]!.uploadUrl.startsWith(origin)).toBe(true);
    const feed = await (await fetch(origin)).text();
    expect(feed).toContain("Hello (Vegas)");
    expect(feed).toContain(postUrn);
    expect([...new Uint8Array(await (await fetch(`${origin}/fake/images/1.png`)).arrayBuffer())]).toEqual([1, 2, 3]);

    const cancelled = await fetch(`${origin}/fake/consent?redirect_uri=${encodeURIComponent(redirectUri)}&state=st&decision=cancel`, {
      redirect: "manual",
    });
    expect(new URL(cancelled.headers.get("location") ?? "").searchParams.get("error")).toBe("user_cancelled_authorize");
  });
});
