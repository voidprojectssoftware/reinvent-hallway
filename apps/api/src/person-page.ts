// /@handle is a web app page, but the static assets layer will not serve it:
// it re-encodes each path segment with encodeURIComponent and redirects when
// the result differs, so /@jane answers 307 to /%40jane and every share link
// would change in the address bar. So the Worker takes /@* first
// (wrangler.jsonc run_worker_first) and answers with the web app's
// index.html itself, under the URL as typed.
//
// It is also the link preview (ADR 0005, issue #16). LinkedIn, Slack and the
// rest read Open Graph tags from the HTML and run no script, so the tags go
// into index.html here. They always describe what an anonymous visitor may
// see, whoever asks: a preview card is shown to everyone in a feed, so a
// connections-only or private schedule previews as the name alone.
import { anonymous, shareImagePath, type GetSharedSchedule, type SharedSchedule } from "@hallway/application";
import { cardHeight, cardWidth, eventSpan, showsWeek } from "./sharing/share-card.ts";

/** The part of the ASSETS binding this needs. */
export interface Assets {
  fetch(input: string): Promise<Response>;
}

export function isPersonPage(url: URL): boolean {
  return url.pathname.startsWith("/@");
}

const escapeAttribute = (value: string) =>
  value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** The tags for one person's preview, as anyone without a sign-in would see it. */
export function previewTags(shared: SharedSchedule, origin: string): { title: string; tags: string } {
  const { attendee, event } = shared;
  const title = `${attendee.displayName} at ${event.name}`;
  const n = shared.entries.length;
  // An empty public week previews like a hidden one (issue #41), and its
  // image is the name-only card for the same reason (showsWeek).
  const week = showsWeek(shared);
  const description = week
    ? [attendee.headline, `${n} ${n === 1 ? "session" : "sessions"}, ${eventSpan(event)}, on Hallway.`]
        .filter(Boolean)
        .join(" · ")
    : [attendee.headline, `On Hallway for ${event.name}.`].filter(Boolean).join(" · ");
  const page = new URL(`/@${attendee.handle}`, origin).href;
  const image = new URL(shareImagePath(attendee.handle, shared.version), origin).href;
  const alt = week ? `${attendee.displayName}'s week at ${event.name}` : attendee.displayName;
  const meta = (key: "name" | "property", name: string, content: string) =>
    `<meta ${key}="${name}" content="${escapeAttribute(content)}" />`;
  const tags = [
    meta("name", "description", description),
    // Only a public schedule is offered to search engines.
    ...(shared.scheduleVisible ? [] : [meta("name", "robots", "noindex")]),
    meta("property", "og:site_name", "Hallway by Void Projects"),
    meta("property", "og:type", "profile"),
    meta("property", "og:title", title),
    meta("property", "og:description", description),
    meta("property", "og:url", page),
    meta("property", "og:image", image),
    meta("property", "og:image:type", "image/png"),
    meta("property", "og:image:width", String(cardWidth)),
    meta("property", "og:image:height", String(cardHeight)),
    meta("property", "og:image:alt", alt),
    meta("name", "twitter:card", "summary_large_image"),
    meta("name", "twitter:title", title),
    meta("name", "twitter:description", description),
    meta("name", "twitter:image", image),
  ].join("\n    ");
  return { title, tags };
}

/**
 * The web app's shell, which routes /@handle in the browser, with the
 * preview's tags in its head. An unknown handle gets the plain shell and 404,
 * and the app shows its own not-found.
 */
export async function personPage(url: URL, assets: Assets, getSharedSchedule: GetSharedSchedule): Promise<Response> {
  const shell = await assets.fetch(new URL("/", url).href);
  let handle = "";
  try {
    handle = decodeURIComponent(url.pathname.slice(2).split("/")[0] ?? "");
  } catch {
    // A malformed escape names no one; it falls through to not-found.
  }
  const shared = handle ? await getSharedSchedule(anonymous, { handle }) : undefined;
  let html = await shell.text();
  if (shared?.ok) {
    const { title, tags } = previewTags(shared.value, url.origin);
    html = html
      .replace(/<title>[^<]*<\/title>/, `<title>${escapeAttribute(title)} · Hallway</title>`)
      .replace("</head>", `    ${tags}\n  </head>`);
  }
  const headers = new Headers(shell.headers);
  // The tags follow the schedule, so a cache must ask again each time.
  headers.set("cache-control", "no-cache");
  headers.delete("etag");
  headers.delete("content-length");
  return new Response(html, { status: shared?.ok ? 200 : 404, headers });
}
