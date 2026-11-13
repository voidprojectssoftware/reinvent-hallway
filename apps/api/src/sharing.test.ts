// Sharing through the Worker's routes, over the in-memory fakes and the real
// share card renderer (its wasm and fonts read from disk, as the Worker gets
// them through wrangler's module rules): the share sheet's links, the PNG, and
// the calendar feed, each through the one visibility rule.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import type { Me, ShareLinks } from "@hallway/contracts";
import { reinvent2026 } from "@hallway/infrastructure";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app.ts";
import { escapeText, foldLine } from "./sharing/ical.ts";
import { cardRenderer } from "./sharing/png.ts";
import { shareCard, type CardNode } from "./sharing/share-card.ts";
import { inMemoryHandlers } from "./testing/in-memory-handlers.ts";

const require = createRequire(import.meta.url);
const file = (specifier: string) => new Uint8Array(readFileSync(require.resolve(specifier)));
const font = (name: string, weight: 400 | 600 | 700) => ({
  name: "Inter",
  data: file(`@fontsource/inter/files/inter-${name}-${weight}-normal.woff`).buffer as ArrayBuffer,
  weight,
  style: "normal" as const,
});
const renderer = cardRenderer({
  yoga: file("satori/yoga.wasm"),
  resvg: file("@resvg/resvg-wasm/index_bg.wasm"),
  fonts: [font("latin", 400), font("latin", 600), font("latin", 700), font("latin-ext", 400)],
});

interface Fixture {
  schedule: { reserved: string[]; favorites: string[] };
  sessions: { sessionId: string; title?: string; abstract?: string }[];
}
const fixture = JSON.parse(
  readFileSync(new URL("./schedule-fixtures/aws-reinvent2026-schedule.json", import.meta.url), "utf8"),
) as Fixture;

const bindings = { DEV_SIGN_IN: "1" };
const origin = "http://127.0.0.1:8787";
let call: (path: string, init?: RequestInit & { as?: string }) => Promise<Response>;

beforeEach(() => {
  const { handlers } = inMemoryHandlers({ now: () => new Date("2026-11-13T12:00:00.000Z") });
  const app = createApp<typeof bindings>({ handlers: () => handlers, renderPng: renderer.png });
  call = async (path, { as, ...init } = {}) => {
    const headers = new Headers(init.headers);
    headers.set("content-type", "application/json");
    if (as) headers.set("authorization", `Bearer dev:${as}`);
    return app.fetch(new Request(`${origin}${path}`, { ...init, headers }), bindings);
  };
});

/** Signs in, syncs the fixture's AWS schedule, sets visibility; returns the attendee. */
async function attendee(name: string, visibility: "public" | "connections" | "private"): Promise<Me> {
  const me = (await (await call("/api/dev/sign-in", { method: "POST", body: JSON.stringify({ name }) })).json()) as Me;
  await call("/api/events/reinvent2026/my-schedule", {
    as: me.id,
    method: "PUT",
    body: JSON.stringify({ sessions: fixture.sessions, ...fixture.schedule }),
  });
  await call("/api/me/visibility", { as: me.id, method: "PUT", body: JSON.stringify({ visibility }) });
  return me;
}

const hide = (me: Me, sessionId: string) =>
  call(`/api/events/reinvent2026/my-schedule/entries/${sessionId}`, {
    as: me.id,
    method: "PATCH",
    body: JSON.stringify({ hidden: true }),
  });

/** Width and height from a PNG's IHDR, after checking its signature. */
function pngSize(bytes: Uint8Array): [number, number] {
  expect([...bytes.slice(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const view = new DataView(bytes.buffer, bytes.byteOffset);
  return [view.getUint32(16), view.getUint32(20)];
}

/** Every string a card tree would draw. */
const texts = (node: CardNode | string): string[] =>
  typeof node === "string"
    ? [node]
    : [node.props.children ?? []].flat().flatMap((child) => texts(child as CardNode | string));

describe("GET /api/me/share", () => {
  it("gives my page, my versioned card and, once made, my calendar feed", async () => {
    const me = await attendee("Sam Okafor", "public");
    const before = (await (await call("/api/me/share", { as: me.id })).json()) as ShareLinks;
    expect(before.pageUrl).toBe(`${origin}/@${me.handle}`);
    expect(before.imageUrl).toMatch(new RegExp(`^${origin}/og/${me.handle}\\.png\\?v=[0-9a-f]{16}$`));
    expect(before.calendarUrl).toBeUndefined();

    await call("/api/me/calendar-feed/rotate", { as: me.id, method: "POST" });
    const after = (await (await call("/api/me/share", { as: me.id })).json()) as ShareLinks;
    expect(after.calendarUrl).toMatch(new RegExp(`^${origin}/cal/[A-Za-z0-9_-]{43}\\.ics$`));
  });

  it("gives a new image URL when the schedule changes, so LinkedIn fetches the card again", async () => {
    const me = await attendee("Sam Okafor", "public");
    const imageUrl = async () => ((await (await call("/api/me/share", { as: me.id })).json()) as ShareLinks).imageUrl;
    const first = await imageUrl();
    expect(await imageUrl()).toBe(first);
    await hide(me, "s-aim3315");
    expect(await imageUrl()).not.toBe(first);
  });

  it("asks an anonymous caller to sign in", async () => {
    expect((await call("/api/me/share")).status).toBe(401);
  });
});

describe("GET /og/{handle}.png", () => {
  it("draws a 1200 by 627 PNG, cacheable for a day when anonymous and current, never when signed in", async () => {
    const me = await attendee("Sam Okafor", "public");
    const { imageUrl } = (await (await call("/api/me/share", { as: me.id })).json()) as ShareLinks;
    const path = new URL(imageUrl).pathname + new URL(imageUrl).search;

    const anonymous = await call(path);
    expect(anonymous.status).toBe(200);
    expect(anonymous.headers.get("content-type")).toBe("image/png");
    expect(anonymous.headers.get("cache-control")).toBe("public, max-age=86400, immutable");
    expect(pngSize(new Uint8Array(await anonymous.arrayBuffer()))).toEqual([1200, 627]);

    expect((await call(`/og/${me.handle}.png?v=stale`)).headers.get("cache-control")).toBe("public, max-age=300");
    expect((await call(path, { as: me.id })).headers.get("cache-control")).toBe("private, no-store");
  });

  it("draws one day when asked, and refuses a day outside the event", async () => {
    const me = await attendee("Sam Okafor", "public");
    const day = await call(`/og/${me.handle}.png?day=2026-12-01`);
    expect(pngSize(new Uint8Array(await day.arrayBuffer()))).toEqual([1200, 627]);
    expect((await call(`/og/${me.handle}.png?day=2026-12-25`)).status).toBe(400);
  });

  it("answers 404 for an unknown handle", async () => {
    expect((await call("/og/nobody.png")).status).toBe(404);
  });
});

describe("the share card", () => {
  const event = reinvent2026;
  const entry = (title: string, startsAt: string, hidden = false) => ({
    intent: "reserved" as const,
    session: { sessionId: title, eventId: event.eventId, title, startsAt, venue: "Wynn", lastSeenAt: startsAt },
    hidden,
  });
  const attendeeCard = { id: "a1", handle: "sam", displayName: "Sam Okafor", headline: "Platform Engineer" };

  it("shows the week in Las Vegas time, two a day, then a count", () => {
    const card = shareCard(
      {
        attendee: attendeeCard,
        event,
        scheduleVisible: true,
        version: "x",
        entries: [
          entry("Monday one", "2026-11-30T18:00:00.000Z"),
          entry("Tuesday one", "2026-12-01T16:00:00.000Z"),
          entry("Tuesday two", "2026-12-01T19:30:00.000Z"),
          entry("Tuesday three", "2026-12-01T22:00:00.000Z"),
        ],
      },
      { pageLabel: "hallway.example/@sam" },
    );
    const drawn = texts(card);
    expect(drawn).toEqual(expect.arrayContaining(["Sam Okafor at re:Invent 2026", "10:00 AM", "8:00 AM", "11:30 AM", "and 1 more"]));
    expect(drawn).toContain("Platform Engineer · 4 sessions, 30 Nov to 4 Dec");
    expect(drawn).toContain("· times are Las Vegas time (PST)");
    expect(drawn).not.toContain("Tuesday three");
  });

  it("draws what attendees typed as glyph outlines, so markup in a title never reaches the SVG as markup", async () => {
    const hostile = '"/><image href="https://evil.example/x.png"/><text>pwned</text><path d="';
    const svg = await renderer.svg(
      shareCard(
        {
          attendee: { ...attendeeCard, displayName: `Sam ${hostile}` },
          event,
          scheduleVisible: true,
          version: "x",
          entries: [entry(hostile, "2026-11-30T18:00:00.000Z")],
        },
        { pageLabel: "hallway.example/@sam" },
      ),
    );
    expect(svg).not.toContain("evil.example");
    expect(svg).not.toMatch(/<image|<text/);
  });

  it("shows nothing about the week when the schedule is not visible: no count, no days", () => {
    const card = shareCard(
      { attendee: attendeeCard, event, scheduleVisible: false, version: "x", entries: [] },
      { pageLabel: "hallway.example/@sam" },
    );
    const drawn = texts(card).join(" ");
    expect(drawn).toContain("Sam Okafor at re:Invent 2026");
    expect(drawn).not.toMatch(/session|Mon|Tue|Dec/);
  });
});

describe("GET /cal/{token}.ics", () => {
  async function feedOf(me: Me) {
    const { calendarUrl } = (await (
      await call("/api/me/calendar-feed/rotate", { as: me.id, method: "POST" }).then(() =>
        call("/api/me/share", { as: me.id }),
      )
    ).json()) as ShareLinks;
    return new URL(calendarUrl!).pathname;
  }
  const events = (ics: string) => ics.split("BEGIN:VEVENT").slice(1);
  const unfold = (ics: string) => ics.replace(/\r\n /g, "");

  it("serves the owner's non-hidden schedule, even a private one, in Las Vegas wall time with stable UIDs", async () => {
    const me = await attendee("Sam Okafor", "private");
    await hide(me, "s-dat302");
    const path = await feedOf(me);
    const response = await call(path);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/calendar; charset=utf-8");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const ics = await response.text();

    expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(ics).toContain("BEGIN:VTIMEZONE\r\nTZID:America/Los_Angeles");
    for (const line of ics.split("\r\n")) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    const text = unfold(ics);
    expect(text).toContain("DTSTART;TZID=America/Los_Angeles:20261130T193000");
    expect(text).toContain("SUMMARY:Monday Night Live (KEY001)");
    expect(text).toContain("URL:https://example.test/catalog?search=KEY001");
    expect(text).not.toContain("s-dat302");
    expect(text).not.toContain("ABSTRACT-TEXT");
    const uids = events(text).map((e) => /UID:(.*)\r\n/.exec(e)?.[1]);
    expect(new Set(uids).size).toBe(uids.length);
    expect(unfold(await (await call(path)).text()).match(/UID:.*\r\n/g)).toEqual(text.match(/UID:.*\r\n/g));
  });

  it("stops answering the old address the moment the feed is rotated", async () => {
    const me = await attendee("Sam Okafor", "public");
    const old = await feedOf(me);
    const fresh = await feedOf(me);
    expect((await call(old)).status).toBe(404);
    expect((await call(fresh)).status).toBe(200);
  });

  it("answers 404 to a token that is no one's, and to a path that is not a token", async () => {
    expect((await call(`/cal/${"A".repeat(43)}.ics`)).status).toBe(404);
    expect((await call("/cal/not a token.ics")).status).toBe(404);
  });
});

describe("iCalendar text", () => {
  it("escapes commas, semicolons, backslashes and newlines", () => {
    expect(escapeText("a, b; c\\d\ne")).toBe("a\\, b\\; c\\\\d\\ne");
  });

  it("folds at 75 octets without splitting a character", () => {
    const line = `SUMMARY:${"é".repeat(60)}`;
    const folded = foldLine(line).split("\r\n");
    for (const part of folded) expect(new TextEncoder().encode(part).length).toBeLessThanOrEqual(75);
    expect(folded.map((part, i) => (i === 0 ? part : part.slice(1))).join("")).toBe(line);
  });
});
