// Telling people which sessions I am going to (issue #78, ADR 0026): the
// composer's draft, my picture of a selection, and the LinkedIn round trip.
// Each route calls one posting handler; what is left here is HTTP's part: the
// PNG and its headers, the state cookie, and redirecting the browser.
import { createRoute, z } from "@hono/zod-openapi";
import { selectionSearch } from "@hallway/application";
import type { ShareSelection } from "@hallway/domain";
import { BeginLinkedInPostInput, BegunLinkedInPost, PostDraft, ShareSelectionQuery } from "@hallway/contracts";
import type { ApiApp } from "../app.ts";
import { postCallbackPath, setPostStateCookie, takePostStateCookie } from "../auth/cookies.ts";
import type { DevSignInBindings } from "../auth/dev-sign-in.ts";
import { errorResponses, refuse, respond } from "../outcome-http.ts";
import type { RenderPng } from "../sharing/png.ts";
import { shareCard } from "../sharing/share-card.ts";

const tags = ["sharing"];
const personOnly = "Only to me signed in as a person: 401 signed out, 403 to an agent token.";

const composeRoute = createRoute({
  method: "get",
  path: "/api/me/share/post",
  operationId: "composePost",
  summary: "The composer's draft for my whole week, one day (`day`) or chosen sessions (`session`, repeated)",
  description: `Prefilled text (never an abstract), the picture of exactly that selection, and whether Hallway can post it for me. ${personOnly}`,
  tags,
  request: { query: ShareSelectionQuery },
  responses: { 200: { description: "The draft.", content: { "application/json": { schema: PostDraft } } }, ...errorResponses },
});

const myImageRoute = createRoute({
  method: "get",
  path: "/api/me/share-image.png",
  operationId: "getMyShareImage",
  summary: "My own picture of my week, a day or chosen sessions, hidden sessions left out. Never cached",
  description: `Never the same address as the link preview's card (\`/og/{handle}.png\`), which is always the anonymous view (#70). ${personOnly}`,
  tags,
  request: { query: ShareSelectionQuery },
  responses: {
    200: { description: "A 1200 by 627 PNG.", content: { "image/png": { schema: z.string().meta({ format: "binary" }) } } },
    ...errorResponses,
  },
});

const beginRoute = createRoute({
  method: "post",
  path: "/api/me/share/post",
  operationId: "beginLinkedInPost",
  summary: "Hold my post for ten minutes and get LinkedIn's consent page, asking to post for me once",
  description: `Sets a state cookie for the callback; send the browser to \`authorizationUrl\`. Nothing is posted until LinkedIn sends me back. 404 when this server cannot post to LinkedIn, 409 when I have not linked LinkedIn. ${personOnly}`,
  tags,
  request: { body: { content: { "application/json": { schema: BeginLinkedInPostInput } }, required: true } },
  responses: {
    200: { description: "Where to send the browser.", content: { "application/json": { schema: BegunLinkedInPost } } },
    ...errorResponses,
  },
});

const callbackRoute = createRoute({
  method: "get",
  path: postCallbackPath,
  operationId: "completeLinkedInPost",
  summary: "LinkedIn's redirect back: posts the held draft with its picture, then drops LinkedIn's token",
  description:
    "A browser navigation, so it always redirects to the composer it started from: with `posted=<post URN>` when the post went out, or `error=<kind>` when it did not (nothing was posted).",
  tags,
  request: {
    query: z.object({
      code: z.string().optional(),
      state: z.string().optional(),
      error: z.string().optional(),
      error_description: z.string().optional(),
    }),
  },
  responses: { 302: { description: "Back to the composer.", headers: z.object({ location: z.string() }) } },
});

/** The query's selection as the domain's. */
function selectionOf(query: { day?: string | undefined; session?: string[] | undefined }): ShareSelection {
  if (query.day) return { kind: "day", day: query.day };
  if (query.session) return { kind: "sessions", sessionIds: query.session };
  return { kind: "week" };
}

/** The composer page for a selection: where the round trip comes back to. */
export const composerPath = (selection: ShareSelection) => `/share/post${selectionSearch(selection)}`;

const withParam = (path: string, name: string, value: string) => {
  const url = new URL(path, "http://hallway.invalid");
  url.searchParams.set(name, value);
  return `${url.pathname}${url.search}`;
};

export function registerPostRoutes<B extends DevSignInBindings>(app: ApiApp<B>, renderPng: RenderPng) {
  const pageLabel = (requestUrl: string, handle: string) => `${new URL(requestUrl).host}/@${handle}`;

  app.openapi(composeRoute, async (c) =>
    respond(
      c,
      await c.var.handlers.posting.composePost(c.var.actor, {
        origin: new URL(c.req.url).origin,
        selection: selectionOf(c.req.valid("query")),
      }),
    ),
  );

  app.openapi(myImageRoute, async (c) => {
    const picture = await c.var.handlers.posting.getMyShareImage(c.var.actor, { selection: selectionOf(c.req.valid("query")) });
    if (!picture.ok) return refuse(c, picture.error);
    const { shared, day } = picture.value;
    const png = await renderPng(shareCard(shared, { ...(day && { day }), pageLabel: pageLabel(c.req.url, shared.attendee.handle) }));
    // Only its owner may see it, so nothing may keep it: not the browser, not a cache in front.
    return c.body(png as Uint8Array<ArrayBuffer>, 200, { "content-type": "image/png", "cache-control": "private, no-store" });
  });

  app.openapi(beginRoute, async (c) => {
    const { text, day, sessionIds } = c.req.valid("json");
    const selection = selectionOf({ day, session: sessionIds });
    const begun = await c.var.handlers.posting.beginLinkedInPost(c.var.actor, {
      text,
      selection,
      redirectUri: new URL(postCallbackPath, c.req.url).href,
    });
    if (!begun.ok) return refuse(c, begun.error);
    setPostStateCookie(c, { state: begun.value.state, returnTo: composerPath(selection) });
    return c.json({ authorizationUrl: begun.value.authorizationUrl }, 200);
  });

  app.openapi(callbackRoute, async (c) => {
    const { code, state, error } = c.req.valid("query");
    const started = takePostStateCookie(c);
    const back = started.returnTo ?? "/share/post";
    try {
      const posted = await c.var.handlers.posting.completeLinkedInPost(c.var.actor, {
        code,
        state,
        expectedState: started.state,
        error,
        redirectUri: new URL(postCallbackPath, c.req.url).href,
        render: ({ shared, day }) =>
          renderPng(shareCard(shared, { ...(day && { day }), pageLabel: pageLabel(c.req.url, shared.attendee.handle) })),
      });
      return c.redirect(posted.ok ? withParam(back, "posted", posted.value.postUrn) : withParam(back, "error", posted.error.kind), 302);
    } catch (failure) {
      // LinkedIn failed part way (the upload, the post). Logged with its
      // detail, never the token, which only the adapter ever held; the person
      // is told nothing was posted and may try again.
      console.error("LinkedIn post failed", failure);
      return c.redirect(withParam(back, "error", "unavailable"), 302);
    }
  });
}
