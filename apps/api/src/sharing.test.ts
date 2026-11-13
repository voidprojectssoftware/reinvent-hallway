// Sharing through the Worker's routes, over the in-memory fakes and the real
// share card renderer (its wasm and fonts read from disk, as the Worker gets
// them through wrangler's module rules): the share sheet's links, the PNG, and
// the calendar feed, each through the one visibility rule.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import type { Me, ShareLinks } from "@hallway/contracts";
import { reinvent2026 } from "@hallway/infrastructure";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "./app.ts";
import { personPage } from "./person-page.ts";
import { escapeText, foldLine } from "./sharing/ical.ts";
import { fallbacksFor, fallbackSubsets } from "./sharing/fallback-fonts.ts";
import { cardRenderer } from "./sharing/png.ts";
import { cardTexts, shareCard, type CardNode } from "./sharing/share-card.ts";
import { inMemoryHandlers } from "./testing/in-memory-handlers.ts";

const require = createRequire(import.meta.url);
const file = (specifier: string) => new Uint8Array(readFileSync(require.resolve(specifier)));
const inter = (weight: 400 | 600 | 700) => ({
  name: "Inter",
  data: file(`@fontsource/inter/files/inter-latin-${weight}-normal.woff`).buffer as ArrayBuffer,
  weight,
  style: "normal" as const,
});
/** Each fallback font file the renderer asked for, in order: the Worker fetches these from its assets. */
const fontsLoaded: string[] = [];
/** The package a fallback file comes from, as copy-card-fonts.mjs finds it. */
const fallbackFile = (name: string) => {
  const subset = fallbackSubsets.find((s) => s.weights.some((w) => s.file(w) === name))!;
  return `${subset.pkg}/files/${name}`;
};
const renderer = cardRenderer({
  yoga: file("satori/yoga.wasm"),
  resvg: file("@resvg/resvg-wasm/index_bg.wasm"),
  fonts: [inter(400), inter(600), inter(700)],
  loadFont: async (name) => {
    fontsLoaded.push(name);
    return file(fallbackFile(name)).buffer as ArrayBuffer;
  },
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
let handlers: ReturnType<typeof inMemoryHandlers>["handlers"];
/** Every card the share image route drew, as the renderer was handed it. */
let drawn: CardNode[];

beforeEach(() => {
  handlers = inMemoryHandlers({ now: () => new Date("2026-11-13T12:00:00.000Z") }).handlers;
  drawn = [];
  const app = createApp<typeof bindings>({
    handlers: () => handlers,
    renderPng: async (card) => {
      drawn.push(card);
      return renderer.png(card);
    },
  });
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
    const drawn = cardTexts(card);
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
    const drawn = cardTexts(card).join(" ");
    expect(drawn).toContain("Sam Okafor at re:Invent 2026");
    expect(drawn).not.toMatch(/session|Mon|Tue|Dec/);
  });

  it("shows the name alone for an empty week, not 0 sessions over five blank days", () => {
    const card = shareCard(
      { attendee: attendeeCard, event, scheduleVisible: true, version: "x", entries: [] },
      { pageLabel: "hallway.example/@sam" },
    );
    const drawn = cardTexts(card).join(" ");
    expect(drawn).toContain("Sam Okafor at re:Invent 2026");
    expect(drawn).toContain("Nothing planned this week yet.");
    expect(drawn).not.toMatch(/session|Mon|Tue|Dec|Las Vegas/);
  });
});

describe("the share card's fonts", () => {
  const attendeeLatin = { id: "a1", handle: "sam", displayName: "Sam Okafor", headline: "Platform Engineer" };
  /** The SVG of `text` alone in the card's name style: its glyph outlines, or Inter's missing-glyph box. */
  const outline = (text: string) =>
    renderer.svg({ type: "div", props: { style: { display: "flex", fontFamily: "Inter", fontSize: 40, fontWeight: 700 }, children: text } });

  it("draws each script's letters as their own shapes, not as the missing-glyph box", async () => {
    const pairs = [
      ["Ł", "Ś"], // Latin Extended (Polish)
      ["Ж", "П"], // Cyrillic
      ["Ω", "Σ"], // Greek
      ["Ư", "Ở"], // Vietnamese
      ["山", "田"], // Han, from Noto Sans JP
      ["か", "な"], // Kana
      ["한", "국"], // Hangul
      ["这", "们"], // Simplified Chinese, not in Noto Sans JP
    ];
    for (const [a, b] of pairs) expect(await outline(a!), `${a} and ${b}`).not.toBe(await outline(b!));
  });

  it("would catch a dropped glyph: two characters no font has draw the same box, and the server says so", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect(await outline("ก")).toBe(await outline("ข")); // Thai
      expect(warn).toHaveBeenCalledWith("share card: no font draws U+0E01");
    } finally {
      warn.mockRestore();
    }
  });

  it("loads no fallback for a Latin card, and a fallback once for every card after", async () => {
    fontsLoaded.length = 0;
    const card = (displayName: string) =>
      shareCard(
        { attendee: { ...attendeeLatin, displayName }, event: reinvent2026, scheduleVisible: false, version: "x", entries: [] },
        { pageLabel: "hallway.example/@sam" },
      );
    await renderer.svg(card("Sam Okafor"));
    expect(fontsLoaded).toEqual([]);
    await renderer.svg(card("Ꙗрослава")); // a Cyrillic Extended capital, which no other test asks for
    expect(fontsLoaded).toEqual([400, 600, 700].map((w) => `inter-cyrillic-ext-${w}-normal.woff`));
    await renderer.svg(card("Ꙗрослава Ꙗ"));
    expect(fontsLoaded).toHaveLength(3);
  });

  it("picks fallbacks by code point: Inter's own subsets first, then Noto Sans JP, KR and SC", () => {
    const names = (text: string) => fallbacksFor(text).subsets.map((s) => s.name);
    expect(fallbacksFor("Sam Okafor, Café Zoë")).toEqual({ subsets: [], uncovered: [] });
    expect(names("Łukasz")).toEqual(["inter latin-ext"]);
    expect(names("Ольга Петрова")).toEqual(["inter cyrillic"]);
    expect(names("Γιώργος")).toEqual(["inter greek"]);
    expect(names("山田 太郎").every((name) => name.startsWith("noto-sans-jp "))).toBe(true);
    expect(names("김민준").every((name) => name.startsWith("noto-sans-kr "))).toBe(true);
    expect(names("这们").every((name) => name.startsWith("noto-sans-sc "))).toBe(true);
    expect(fallbacksFor("שלום 😀").uncovered).toEqual([0x5e9, 0x5dc, 0x5d5, 0x5dd, 0x1f600]);
  });

  it("names only files that exist, so the copy script and the Worker's fetch find every one", () => {
    for (const subset of fallbackSubsets) {
      for (const weight of subset.weights) expect(() => require.resolve(`${subset.pkg}/files/${subset.file(weight)}`)).not.toThrow();
    }
  });
});

describe("what leaves Hallway never carries an abstract (ADR 0025)", () => {
  it("not the link preview nor the share card of a verified owner, whoever asks", async () => {
    // Sam's agent synced the fixture, abstracts included: Sam may read them on Hallway.
    const me = await attendee("Sam Okafor", "public");
    const session = await call("/api/events/reinvent2026/sessions/s-aim3315", { as: me.id });
    expect(await session.text()).toContain("ABSTRACT-TEXT-AIM3315");

    for (const as of [undefined, me.id]) {
      const card = await call(`/og/${me.handle}.png`, as ? { as } : {});
      expect(card.status).toBe(200);
    }
    expect(drawn).toHaveLength(2);
    for (const card of drawn) {
      const texts = cardTexts(card).join("\n");
      expect(texts).toContain("Monday Night Live");
      expect(texts).not.toContain("ABSTRACT-TEXT");
    }

    const shell = "<!doctype html><html><head><title>Hallway</title></head><body></body></html>";
    const page = await personPage(
      new URL(`${origin}/@${me.handle}`),
      { fetch: async () => new Response(shell, { headers: { "content-type": "text/html" } }) },
      handlers.sharing.getSharedSchedule,
    );
    const html = await page.text();
    expect(html).toContain(me.displayName);
    expect(html).not.toContain("ABSTRACT-TEXT");
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
