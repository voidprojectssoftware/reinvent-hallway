import { fail, ok, type GetSharedSchedule, type SharedSchedule } from "@hallway/application";
import { reinvent2026 } from "@hallway/infrastructure";
import { describe, expect, it } from "vitest";
import { isPersonPage, personPage } from "./person-page.ts";

const shell = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Hallway</title>
  </head>
  <body><div id="root"></div></body>
</html>`;

function assets() {
  const asked: string[] = [];
  return {
    asked,
    fetch: async (input: string) => {
      asked.push(input);
      return new Response(shell, { headers: { "content-type": "text/html", etag: '"abc"' } });
    },
  };
}

const shared = (overrides: Partial<SharedSchedule> = {}): SharedSchedule => ({
  attendee: { id: "a1", handle: "jane.doe", displayName: 'Jane "JD" <Doe>', headline: "Engineer, Example & Co" },
  event: reinvent2026,
  scheduleVisible: true,
  entries: [
    {
      intent: "reserved",
      session: {
        sessionId: "s1",
        eventId: reinvent2026.eventId,
        title: "Keynote",
        startsAt: "2026-12-01T16:00:00.000Z",
        lastSeenAt: "2026-11-13T12:00:00.000Z",
      },
    },
  ],
  version: "0123456789abcdef",
  ...overrides,
});
const answering =
  (value: SharedSchedule | undefined): GetSharedSchedule =>
  async () =>
    value ? ok(value) : fail("not-found", "No attendee.");

const meta = (html: string, name: string) =>
  new RegExp(`<meta (?:name|property)="${name}" content="([^"]*)" />`).exec(html)?.[1];

describe("/@handle", () => {
  it("is taken by the Worker for every handle spelling, and nothing else", () => {
    const paths = ["/@jane", "/@jane-doe", "/@jane.doe", "/api/x", "/network", "/%40jane"];
    expect(paths.filter((path) => isPersonPage(new URL(path, "http://127.0.0.1")))).toEqual([
      "/@jane",
      "/@jane-doe",
      "/@jane.doe",
    ]);
  });

  it("answers with the web app's index.html, not a redirect, asking for the handle as typed", async () => {
    const files = assets();
    const handles: string[] = [];
    const response = await personPage(new URL("http://127.0.0.1:8787/@jane.doe?x=1"), files, async (_actor, input) => {
      handles.push(input.handle);
      return ok(shared());
    });
    expect(files.asked).toEqual(["http://127.0.0.1:8787/"]);
    expect(handles).toEqual(["jane.doe"]);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-cache");
    expect(await response.text()).toContain('<div id="root"></div>');
  });

  it("asks as an anonymous visitor, whoever is signed in, because a preview is shown to everyone", async () => {
    const actors: string[] = [];
    await personPage(new URL("http://127.0.0.1:8787/@jane.doe"), assets(), async (actor) => {
      actors.push(actor.kind);
      return ok(shared());
    });
    expect(actors).toEqual(["anonymous"]);
  });

  it("carries escaped Open Graph and Twitter tags, the image versioned by the schedule", async () => {
    const response = await personPage(new URL("https://hallway.example/@jane.doe"), assets(), answering(shared()));
    const html = await response.text();
    expect(meta(html, "og:title")).toBe("Jane &quot;JD&quot; &lt;Doe&gt; at re:Invent 2026");
    expect(meta(html, "og:description")).toBe("Engineer, Example &amp; Co · 1 session, 30 Nov to 4 Dec, on Hallway.");
    expect(meta(html, "og:image:alt")).toBe("Jane &quot;JD&quot; &lt;Doe&gt;&#39;s week at re:Invent 2026");
    expect(meta(html, "og:image")).toBe("https://hallway.example/og/jane.doe.png?v=0123456789abcdef");
    expect(meta(html, "og:url")).toBe("https://hallway.example/@jane.doe");
    expect(meta(html, "twitter:card")).toBe("summary_large_image");
    expect(meta(html, "robots")).toBeUndefined();
    expect(html).toContain("<title>Jane &quot;JD&quot; &lt;Doe&gt; at re:Invent 2026 · Hallway</title>");
  });

  it("gives the same tags with or without an invite token, and never repeats the token", async () => {
    const page = async (path: string) =>
      (await personPage(new URL(`https://hallway.example${path}`), assets(), answering(shared()))).text();
    const bare = await page("/@jane.doe");
    const invited = await page("/@jane.doe?invite=SECRET-INVITE-TOKEN");
    expect(invited).toBe(bare);
    expect(invited).not.toContain("SECRET-INVITE-TOKEN");
  });

  it("previews a schedule the public may not see as the name alone, and keeps it out of search", async () => {
    const response = await personPage(
      new URL("https://hallway.example/@jane.doe"),
      assets(),
      answering(shared({ scheduleVisible: false })),
    );
    const html = await response.text();
    expect(meta(html, "og:description")).toBe("Engineer, Example &amp; Co · On Hallway for re:Invent 2026.");
    expect(meta(html, "robots")).toBe("noindex");
    expect(html).not.toMatch(/session/i);
  });

  it("previews an empty public week as the name alone, not as 0 sessions, and leaves it to search engines", async () => {
    const response = await personPage(
      new URL("https://hallway.example/@jane.doe"),
      assets(),
      answering(shared({ entries: [] })),
    );
    const html = await response.text();
    expect(meta(html, "og:description")).toBe("Engineer, Example &amp; Co · On Hallway for re:Invent 2026.");
    expect(meta(html, "og:image:alt")).toBe("Jane &quot;JD&quot; &lt;Doe&gt;");
    expect(meta(html, "robots")).toBeUndefined();
    expect(html).not.toMatch(/session/i);
  });

  it("answers 404 with the plain shell for an unknown handle", async () => {
    const response = await personPage(new URL("https://hallway.example/@nobody"), assets(), answering(undefined));
    expect(response.status).toBe(404);
    expect(await response.text()).toBe(shell);
  });
});
