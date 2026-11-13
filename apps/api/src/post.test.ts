// Telling people which sessions I am going to (issue #78, ADR 0026), through
// the browser's routes, with the real LinkedIn adapters against the fake
// LinkedIn: compose a selection, consent, upload, post, and every way the
// round trip is refused without posting anything.
import { readFileSync } from "node:fs";
import type { IssuedAgentToken, PostDraft } from "@hallway/contracts";
import { fakeLinkedIn, linkedInOidc, linkedInPoster, littleText } from "@hallway/infrastructure";
import { describe, expect, it } from "vitest";
import { createApp } from "./app.ts";
import { cardTexts, type CardNode } from "./sharing/share-card.ts";
import { Browser, origin } from "./testing/browser.ts";
import { inMemoryHandlers } from "./testing/in-memory-handlers.ts";

interface Fixture {
  schedule: { reserved: string[]; favorites: string[] };
  sessions: { sessionId: string; title?: string; abstract?: string }[];
}
const fixture = JSON.parse(
  readFileSync(new URL("./schedule-fixtures/aws-reinvent2026-schedule.json", import.meta.url), "utf8"),
) as Fixture;
const abstracts = fixture.sessions.flatMap((session) => (session.abstract ? [session.abstract] : []));

const json = (body: unknown, method = "POST"): RequestInit => ({
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

function world(options: { posting?: boolean } = {}) {
  const linkedIn = fakeLinkedIn();
  let clock = new Date("2026-11-13T12:00:00.000Z");
  const drawn: CardNode[] = [];
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 7]);
  const { handlers, drafts } = inMemoryHandlers({
    now: () => clock,
    identity: { providers: { linkedin: linkedInOidc(linkedIn) } },
    ...(options.posting !== false && { poster: linkedInPoster(linkedIn) }),
  });
  const bindings = { DEV_SIGN_IN: "1" };
  const app = createApp<typeof bindings>({
    handlers: () => handlers,
    renderPng: async (card) => {
      drawn.push(card);
      return png;
    },
  });
  const call = async (input: string, init?: RequestInit) => app.fetch(new Request(input, init), bindings);

  /** Signs in with LinkedIn as `sub` (through the fake's consent) and syncs the fixture's week. */
  async function linkedInMember(sub = "li-sam", name = "Sam Okafor") {
    const browser = new Browser(call);
    const start = new URL((await browser.fetch("/api/auth/linkedin")).headers.get("location") ?? "");
    const redirectUri = start.searchParams.get("redirect_uri") ?? "";
    await browser.fetch(`/api/auth/linkedin/callback?code=${linkedIn.issueCode({ sub, name }, redirectUri)}&state=${start.searchParams.get("state")}`);
    await browser.fetch("/api/events/reinvent2026/my-schedule", json({ sessions: fixture.sessions, ...fixture.schedule }, "PUT"));
    return browser;
  }

  async function devMember(name = "Dev Person") {
    const browser = new Browser(call);
    await browser.fetch("/api/dev/sign-in", json({ name }));
    await browser.fetch("/api/events/reinvent2026/my-schedule", json({ sessions: fixture.sessions, ...fixture.schedule }, "PUT"));
    return browser;
  }

  /** POST the draft, then come back through the callback as `sub` agreed at LinkedIn. */
  async function post(browser: Browser, body: object, consent: { sub?: string; query?: (code: string, state: string) => string } = {}) {
    const begun = await browser.fetch("/api/me/share/post", json(body));
    expect(begun.status).toBe(200);
    const location = new URL(((await begun.json()) as { authorizationUrl: string }).authorizationUrl);
    const redirectUri = location.searchParams.get("redirect_uri") ?? "";
    const state = location.searchParams.get("state") ?? "";
    const code = linkedIn.issueCode({ sub: consent.sub ?? "li-sam", name: "Sam Okafor" }, redirectUri);
    const back = await browser.fetch(`/api/me/share/post/callback?${consent.query?.(code, state) ?? `code=${code}&state=${state}`}`);
    expect(back.status).toBe(302);
    return { location, back: new URL(back.headers.get("location") ?? "", origin), code, state };
  }

  const draftOf = async (browser: Browser, query = "") => (await (await browser.fetch(`/api/me/share/post${query}`)).json()) as PostDraft;

  return {
    linkedIn,
    drafts,
    drawn,
    png,
    call,
    linkedInMember,
    devMember,
    post,
    draftOf,
    advance: (ms: number) => (clock = new Date(clock.getTime() + ms)),
  };
}

const hide = (browser: Browser, sessionId: string) =>
  browser.fetch(`/api/events/reinvent2026/my-schedule/entries/${sessionId}`, json({ hidden: true }, "PATCH"));

describe("GET /api/me/share/post: the composer's draft", () => {
  it("prefills the week, a day or chosen sessions with times in Las Vegas time and the page link, never an abstract", async () => {
    const w = world();
    const sam = await w.linkedInMember();
    const week = await w.draftOf(sam);
    expect(week.direct).toEqual({ available: true });
    expect(week.days).toEqual(["2026-11-30", "2026-12-01", "2026-12-02", "2026-12-03", "2026-12-04"]);
    expect(week.selected).toEqual(week.offered.map((s) => s.sessionId));
    expect(week.text).toMatch(/^Where I'll be at re:Invent 2026:/);
    expect(week.text).toContain(`See my week on Hallway: ${origin}/@sam-okafor`);
    expect(week.imageUrl).toBe(`${origin}/api/me/share-image.png`);

    const one = week.offered.find((s) => s.code === "AIM3315")!;
    const single = await w.draftOf(sam, `?session=${one.sessionId}`);
    expect(single.selected).toEqual([one.sessionId]);
    expect(single.text).toMatch(/^I'm going to this session at re:Invent 2026:\n\n• \w{3} \d+ \w{3}, \d+:\d{2} [AP]M: .+ \(AIM3315\)/);
    expect(single.imageUrl).toBe(`${origin}/api/me/share-image.png?session=${one.sessionId}`);

    const day = await w.draftOf(sam, `?day=${one.day}`);
    expect(day.selected).toContain(one.sessionId);
    expect(day.offered.filter((s) => s.day === one.day).map((s) => s.sessionId)).toEqual(day.selected);

    for (const draft of [week, single, day]) for (const abstract of abstracts) expect(draft.text).not.toContain(abstract);
    expect(abstracts.length).toBeGreaterThan(0);
  });

  it("never offers a hidden session, and says when the link preview shows only my name", async () => {
    const w = world();
    const sam = await w.linkedInMember();
    const before = await w.draftOf(sam);
    expect(before.linkPreviewShowsWeek).toBe(false);
    const hidden = before.offered[0]!.sessionId;
    await hide(sam, hidden);
    const after = await w.draftOf(sam);
    expect(after.offered.map((s) => s.sessionId)).not.toContain(hidden);
    expect((await sam.fetch(`/api/me/share/post?session=${hidden}`)).status).toBe(400);
    await sam.fetch("/api/me/visibility", json({ visibility: "public" }, "PUT"));
    expect((await w.draftOf(sam)).linkPreviewShowsWeek).toBe(true);
  });

  it("offers direct posting only to someone with LinkedIn linked, on a server set up for it", async () => {
    const w = world();
    expect((await w.draftOf(await w.devMember())).direct).toEqual({ available: false, reason: "no-linkedin-identity" });
    const off = world({ posting: false });
    expect((await off.draftOf(await off.linkedInMember())).direct).toEqual({ available: false, reason: "not-configured" });
  });
});

describe("posting to LinkedIn, against the fake LinkedIn", () => {
  it("asks for w_member_social, holds the draft, uploads the picture of the selection and posts the text as written", async () => {
    const w = world();
    const sam = await w.linkedInMember();
    const { offered } = await w.draftOf(sam);
    const picked = [offered[0]!.sessionId, offered[2]!.sessionId];
    const text = "Find me at these (both in Vegas) #reInvent";
    const { location, back } = await w.post(sam, { text, sessionIds: picked });

    expect(location.searchParams.get("scope")).toBe("openid profile w_member_social");
    expect(location.searchParams.get("redirect_uri")).toBe(`${origin}/api/me/share/post/callback`);
    expect(back.pathname).toBe("/share/post");
    expect(back.searchParams.getAll("session")).toEqual(picked);
    const urn = back.searchParams.get("posted");
    expect(urn).toMatch(/^urn:li:share:\d+$/);

    expect(w.linkedIn.posts).toEqual([
      expect.objectContaining({ urn, author: "urn:li:person:li-sam", commentary: littleText(text), imageUrn: w.linkedIn.images[0]!.urn }),
    ]);
    expect(w.linkedIn.images[0]!.bytes).toEqual(w.png);
    // The picture drawn for the post is exactly the selection.
    const texts = cardTexts(w.drawn.at(-1)!).join(" ");
    for (const s of offered) expect(texts.includes(s.title!), s.title).toBe(picked.includes(s.sessionId));
    expect(w.drafts.all()).toEqual([]);
  });

  it("posts a day, and a single session", async () => {
    const w = world();
    const sam = await w.linkedInMember();
    const { offered } = await w.draftOf(sam);
    const day = offered.find((s) => s.day)!.day!;
    expect((await w.post(sam, { text: "Tuesday", day })).back.searchParams.get("posted")).toBeTruthy();
    expect((await w.post(sam, { text: "One", sessionIds: [offered[0]!.sessionId] })).back.searchParams.get("posted")).toBeTruthy();
    expect(w.linkedIn.posts.map((p) => p.commentary)).toEqual(["Tuesday", "One"]);
    expect(new Set(w.linkedIn.posts.map((p) => p.urn)).size).toBe(2);
  });

  it("uses a draft once: the same callback again posts nothing", async () => {
    const w = world();
    const sam = await w.linkedInMember();
    const { location, code, state } = await w.post(sam, { text: "Once" });
    expect(location).toBeTruthy();
    const again = await sam.fetch(`/api/me/share/post/callback?code=${code}&state=${state}`);
    expect(new URL(again.headers.get("location") ?? "", origin).searchParams.get("error")).toBe("forbidden");
    expect(w.linkedIn.posts).toHaveLength(1);
  });

  it("posts nothing when the draft waited over ten minutes, the state is not this browser's, or LinkedIn was cancelled", async () => {
    const w = world();
    const sam = await w.linkedInMember();
    const late = await w.post(sam, { text: "Late" }, { query: (code, state) => (w.advance(10 * 60_000 + 1), `code=${code}&state=${state}`) });
    expect(late.back.searchParams.get("error")).toBe("forbidden");
    const forged = await w.post(sam, { text: "Forged" }, { query: (code) => `code=${code}&state=someone-elses` });
    expect(forged.back.searchParams.get("error")).toBe("forbidden");
    const cancelled = await w.post(sam, { text: "No" }, { query: (_code, state) => `error=user_cancelled_authorize&state=${state}` });
    expect(cancelled.back.searchParams.get("error")).toBe("unauthenticated");
    expect(w.linkedIn.posts).toEqual([]);
  });

  it("posts nothing when someone agrees at LinkedIn as a different account from the one linked", async () => {
    const w = world();
    const sam = await w.linkedInMember();
    const { back } = await w.post(sam, { text: "Not mine" }, { sub: "li-somebody-else" });
    expect(back.searchParams.get("error")).toBe("forbidden");
    expect(w.linkedIn.posts).toEqual([]);
  });

  it("tells the person when LinkedIn fails part way, and keeps no token anywhere", async () => {
    const w = world();
    const sam = await w.linkedInMember();
    const { back } = await w.post(sam, { text: "x".repeat(2990) + "((((((((((" });
    // Escaped, the text runs past LinkedIn's limit and the fake refuses the post.
    expect(back.searchParams.get("error")).toBe("unavailable");
    expect(w.linkedIn.posts).toEqual([]);
    const tokens = w.linkedIn.requests.flatMap((r) => (r.authorization ? [r.authorization.replace("Bearer ", "")] : []));
    expect(tokens.length).toBeGreaterThan(0);
    const kept = JSON.stringify(w.drafts.all()) + JSON.stringify(back.href);
    for (const token of tokens) expect(kept).not.toContain(token);
  });

  it("refuses to begin without LinkedIn linked, on a server not set up, for a hidden session, or with no sessions", async () => {
    const w = world();
    expect((await (await w.devMember()).fetch("/api/me/share/post", json({ text: "hi" }))).status).toBe(409);
    const off = world({ posting: false });
    expect((await (await off.linkedInMember()).fetch("/api/me/share/post", json({ text: "hi" }))).status).toBe(404);
    const sam = await w.linkedInMember();
    const { offered } = await w.draftOf(sam);
    await hide(sam, offered[0]!.sessionId);
    expect((await sam.fetch("/api/me/share/post", json({ text: "hi", sessionIds: [offered[0]!.sessionId] }))).status).toBe(400);
    expect((await sam.fetch("/api/me/share/post", json({ text: "hi", day: "2026-11-30" }))).status).toBe(400);
    expect((await sam.fetch("/api/me/share/post", json({ text: "x".repeat(3001) }))).status).toBe(400);
  });

  it("refuses an agent token and a signed-out caller everywhere: posting needs a person at the keyboard", async () => {
    const w = world();
    const sam = await w.linkedInMember();
    const token = (await (await sam.fetch("/api/me/tokens", json({ label: "agent" }))).json()) as IssuedAgentToken;
    const agent = { authorization: `Bearer ${token.secret}`, "content-type": "application/json" };
    for (const [path, init] of [
      ["/api/me/share/post", {}],
      ["/api/me/share-image.png", {}],
      ["/api/me/share/post", { method: "POST", body: JSON.stringify({ text: "hi" }) }],
    ] as const) {
      const asAgent = await w.call(`${origin}${path}`, { ...init, headers: agent });
      expect(asAgent.status, path).toBe(403);
      expect(((await asAgent.json()) as { message: string }).message).toMatch(/agent token cannot/i);
      expect((await w.call(`${origin}${path}`, { ...init, headers: { "content-type": "application/json" } })).status, path).toBe(401);
    }
    expect(w.drafts.all()).toEqual([]);
  });
});
