// Sharing (issue #16): the share sheet's links, the share card PNG and the
// calendar feed. Each calls one sharing handler, which applies the one
// visibility rule; what is left here is the format (PNG, iCalendar) and its
// HTTP headers. /@handle's link preview is person-page.ts.
import { createRoute } from "@hono/zod-openapi";
import { anonymous } from "@hallway/application";
import { ShareLinks } from "@hallway/contracts";
import type { ApiApp } from "../app.ts";
import { errorResponses, refuse, respond } from "../outcome-http.ts";
import { toICalendar } from "../sharing/ical.ts";
import type { RenderPng } from "../sharing/png.ts";
import { eventDays, shareCard } from "../sharing/share-card.ts";
import type { DevSignInBindings } from "../auth/dev-sign-in.ts";

const getShareLinksRoute = createRoute({
  method: "get",
  path: "/api/me/share",
  operationId: "getShareLinks",
  summary:
    "My page, its share card and my calendar feed, for the share sheet. The feed is left out for an agent token and until one is made",
  tags: ["sharing"],
  responses: {
    200: { description: "The links.", content: { "application/json": { schema: ShareLinks } } },
    ...errorResponses,
  },
});

/** A feed token as randomSecret makes it: base64url. Anything else is no one's. */
const feedToken = /^([A-Za-z0-9_-]{16,128})\.ics$/;
const imageName = /^(.+)\.png$/;
const day = /^\d{4}-\d{2}-\d{2}$/;

export function registerSharingRoutes<B extends DevSignInBindings>(app: ApiApp<B>, renderPng: RenderPng) {
  app.openapi(getShareLinksRoute, async (c) =>
    respond(c, await c.var.handlers.sharing.getShareLinks(c.var.actor, { origin: new URL(c.req.url).origin })),
  );

  // The link preview's card: what anyone who opens the link sees, and only
  // that, whoever asks and whatever cookie they send. So one URL is one
  // picture, and a cache keyed by URL (the browser's, a CDN) can never hand
  // the owner's own week to someone else (#70). The owner's picture has its
  // own address, /api/me/share-image.png (routes/post.ts).
  app.get("/og/:file", async (c) => {
    const handle = imageName.exec(c.req.param("file"))?.[1];
    if (!handle) return refuse(c, { kind: "not-found", message: "Expected /og/{handle}.png." });
    const shared = await c.var.handlers.sharing.getSharedSchedule(anonymous, { handle });
    if (!shared.ok) return refuse(c, shared.error);
    const only = c.req.query("day");
    if (only !== undefined && !(day.test(only) && eventDays(shared.value.event).includes(only))) {
      return refuse(c, { kind: "invalid", message: `day must be one of ${eventDays(shared.value.event).join(", ")}.` });
    }
    const png = await renderPng(
      shareCard(shared.value, {
        ...(only ? { day: only } : {}),
        pageLabel: `${new URL(c.req.url).host}/@${shared.value.attendee.handle}`,
      }),
    );
    // The same for everyone, so caches may keep it: for a day when the URL
    // names the current version (a changed schedule gets a new URL), briefly
    // otherwise.
    const cache = c.req.query("v") === shared.value.version ? "public, max-age=86400, immutable" : "public, max-age=300";
    return c.body(png as Uint8Array<ArrayBuffer>, 200, { "content-type": "image/png", "cache-control": cache });
  });

  // The calendar feed. The token in the path is the credential (ADR 0008):
  // never logged, never cached, and gone the moment it is rotated.
  app.get("/cal/:file", async (c) => {
    const token = feedToken.exec(c.req.param("file"))?.[1];
    const feed = token ? await c.var.handlers.sharing.exportCalendar({ token }) : undefined;
    const noStore = { "cache-control": "private, no-store", "referrer-policy": "no-referrer" };
    if (!feed?.ok) {
      return c.text("No calendar feed at this address. It may have been replaced.", 404, noStore);
    }
    return c.body(toICalendar(feed.value, new Date()), 200, {
      ...noStore,
      "content-type": "text/calendar; charset=utf-8",
      "content-disposition": 'inline; filename="hallway.ics"',
    });
  });
}
