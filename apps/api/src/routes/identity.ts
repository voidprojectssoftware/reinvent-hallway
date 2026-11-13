// Sign-in, sign-out, me, agent tokens, calendar feed and attendee cards. Each
// route parses with the contract, calls one identity handler and maps its
// outcome (ADR 0002). The only extra work here is HTTP's own: reading and
// setting cookies, and redirecting the browser to and from the sign-in
// providers (ADR 0018).
import { createRoute, z } from "@hono/zod-openapi";
import {
  AgentToken,
  AgentTokenList,
  AttendeeCard,
  CalendarFeed,
  DevSignInInput,
  GetAttendeeInput,
  IdentityList,
  IssueAgentTokenInput,
  IssuedAgentToken,
  Me,
  ReturnPath,
  RevokeAgentTokenInput,
  SetVisibilityInput,
  SignInOptions,
  SignInProvider,
  UnlinkIdentityInput,
  UpdateProfileInput,
  type ApiError,
} from "@hallway/contracts";
import type { ApiApp } from "../app.ts";
import {
  callbackPath,
  clearSessionCookie,
  readSessionCookie,
  setOAuthStateCookie,
  setSessionCookie,
  takeOAuthStateCookie,
} from "../auth/cookies.ts";
import { devSignInAllowed, type DevSignInBindings } from "../auth/dev-sign-in.ts";
import { errorResponses, refuse, respond } from "../outcome-http.ts";
const json = <T extends z.ZodType>(description: string, schema: T) => ({
  description,
  content: { "application/json": { schema } },
});
const body = <T extends z.ZodType>(schema: T) => ({
  body: { content: { "application/json": { schema } }, required: true },
});
const redirect = (description: string) => ({ description, headers: z.object({ location: z.string() }) });

const tags = ["identity"];

const providerParam = z.object({
  provider: SignInProvider,
});

const beginSignInRoute = createRoute({
  method: "get",
  path: "/api/auth/{provider}",
  operationId: "beginSignIn",
  summary:
    "Start signing in with Google, Microsoft, LinkedIn or GitHub, or (with `link=1`) adding one to the signed-in person: redirects to the provider with a state bound to this browser",
  tags,
  request: {
    params: providerParam,
    query: z.object({
      returnTo: ReturnPath.optional().meta({
        description:
          "A path on this site to land on afterwards (default `/`). Only a relative path starting with a single `/`: another origin, `//host`, a backslash, or an encoded form of them is refused (400).",
        example: "/@jane-doe",
      }),
      link: z.enum(["1"]).optional().meta({
        description:
          "Add this provider to the person signed in, rather than sign in with it. Needs a person signed in on the web: 401 signed out, 403 to an agent token.",
      }),
    }),
  },
  responses: { 302: redirect("To the provider's consent page."), ...errorResponses },
});

const signInCallbackRoute = createRoute({
  method: "get",
  path: "/api/auth/{provider}/callback",
  operationId: "completeSignIn",
  summary:
    "The provider's redirect back: checks the state, then signs in (setting the session cookie) or links the identity to the person who started it",
  description:
    "A browser navigation, so a refusal is a redirect too: to `/sign-in?error=<kind>&provider=<provider>` after a sign-in (with its `returnTo`), or to the link's `returnTo` with the same two parameters. `account-exists` means the provider's verified email already belongs to another Hallway account (ADR 0018).",
  tags,
  request: {
    params: providerParam,
    query: z.object({
      code: z.string().optional(),
      state: z.string().optional(),
      error: z.string().optional(),
      error_description: z.string().optional(),
    }),
  },
  responses: {
    302: redirect("Done: to the `returnTo` the round trip started with, or `/`. Refused: to the page that explains why."),
  },
});

const listIdentitiesRoute = createRoute({
  method: "get",
  path: "/api/me/identities",
  operationId: "listIdentities",
  summary: "The providers I sign in with, oldest first",
  tags,
  responses: { 200: json("My identities.", IdentityList), ...errorResponses },
});

const unlinkIdentityRoute = createRoute({
  method: "delete",
  path: "/api/me/identities/{provider}",
  operationId: "unlinkIdentity",
  summary: "Stop signing in with this provider. Refused (409) for the last one. Web sign-in only: 403 to an agent token",
  tags,
  request: { params: UnlinkIdentityInput },
  responses: { 200: json("The identities left.", IdentityList), ...errorResponses },
});

const devSignInRoute = createRoute({
  method: "post",
  path: "/api/dev/sign-in",
  operationId: "devSignIn",
  summary: "Dev sign-in by name. Only with DEV_SIGN_IN=1 and on a loopback host; 404 otherwise",
  tags,
  request: body(DevSignInInput),
  responses: { 200: json("Signed in; the session cookie is set.", Me), ...errorResponses },
});

const signInOptionsRoute = createRoute({
  method: "get",
  path: "/api/auth/options",
  operationId: "getSignInOptions",
  summary: "Which ways to sign in this server offers, so the sign-in screen shows only those",
  tags,
  responses: { 200: json("The sign-in options.", SignInOptions), ...errorResponses },
});

const signOutRoute = createRoute({
  method: "post",
  path: "/api/auth/sign-out",
  operationId: "signOut",
  summary: "End this browser's session",
  tags,
  responses: { 204: { description: "Signed out; the session cookie is cleared." }, ...errorResponses },
});

const getMeRoute = createRoute({
  method: "get",
  path: "/api/me",
  operationId: "getMe",
  summary: "The signed-in attendee, with private fields",
  tags,
  responses: { 200: json("Me.", Me), ...errorResponses },
});

const updateMeRoute = createRoute({
  method: "patch",
  path: "/api/me",
  operationId: "updateProfile",
  summary: "Change my handle, display name, headline or claimed LinkedIn URL",
  tags,
  request: body(UpdateProfileInput),
  responses: { 200: json("Me, updated.", Me), ...errorResponses },
});

const setVisibilityRoute = createRoute({
  method: "put",
  path: "/api/me/visibility",
  operationId: "setVisibility",
  summary: "Who may see my schedule",
  tags,
  request: body(SetVisibilityInput),
  responses: { 200: json("Me, updated.", Me), ...errorResponses },
});

const listTokensRoute = createRoute({
  method: "get",
  path: "/api/me/tokens",
  operationId: "listAgentTokens",
  summary: "My agent tokens, revoked ones included. Never their secrets. Web sign-in only: 403 to an agent token",
  tags,
  responses: { 200: json("My tokens.", AgentTokenList), ...errorResponses },
});

const issueTokenRoute = createRoute({
  method: "post",
  path: "/api/me/tokens",
  operationId: "issueAgentToken",
  summary: "Issue an agent token; the secret is in this response and never again. Web sign-in only: 403 to an agent token",
  tags,
  request: body(IssueAgentTokenInput),
  responses: { 200: json("The token and its secret.", IssuedAgentToken), ...errorResponses },
});

const revokeTokenRoute = createRoute({
  method: "delete",
  path: "/api/me/tokens/{tokenId}",
  operationId: "revokeAgentToken",
  summary: "Revoke one of my agent tokens. Web sign-in only: 403 to an agent token",
  tags,
  request: { params: RevokeAgentTokenInput },
  responses: { 200: json("The token, revoked.", AgentToken), ...errorResponses },
});

const rotateFeedRoute = createRoute({
  method: "post",
  path: "/api/me/calendar-feed/rotate",
  operationId: "rotateCalendarFeed",
  summary: "Make a new secret calendar feed URL; the old one stops working. Web sign-in only: 403 to an agent token",
  tags,
  responses: { 200: json("The new feed.", CalendarFeed), ...errorResponses },
});

const getFeedRoute = createRoute({
  method: "get",
  path: "/api/me/calendar-feed",
  operationId: "getCalendarFeed",
  summary: "My current calendar feed URL, to subscribe again without rotating. Not to agent tokens",
  tags,
  responses: { 200: json("The current feed.", CalendarFeed), ...errorResponses },
});

const getAttendeeRoute = createRoute({
  method: "get",
  path: "/api/attendees/{handle}",
  operationId: "getAttendee",
  summary: "An attendee's public card, and whether I may see their schedule",
  tags,
  request: { params: GetAttendeeInput },
  responses: { 200: json("The card.", AttendeeCard), ...errorResponses },
});

/**
 * Where a refused callback sends the browser: the sign-in screen (keeping
 * its way back), or for a link, the page the link started from. Only the
 * kind and the provider go in the URL; the web words the page.
 */
function refusedLocation(
  error: ApiError,
  provider: SignInProvider,
  started: { linkFor: string | undefined; returnTo: string },
): string {
  const url = new URL(started.linkFor === undefined ? "/sign-in" : started.returnTo, "http://hallway.invalid");
  if (started.linkFor === undefined && started.returnTo !== "/") url.searchParams.set("returnTo", started.returnTo);
  url.searchParams.set("error", error.kind);
  url.searchParams.set("provider", provider);
  return `${url.pathname}${url.search}${url.hash}`;
}

export function registerIdentityRoutes<B extends DevSignInBindings>(app: ApiApp<B>) {
  const callbackUrl = (provider: SignInProvider, requestUrl: string) =>
    new URL(callbackPath(provider), requestUrl).toString();

  // Before `/api/auth/{provider}`, which would otherwise take "options" for a provider.
  app.openapi(signInOptionsRoute, async (c) =>
    respond(
      c,
      await c.var.handlers.identity.getSignInOptions({ devSignIn: devSignInAllowed(c.req.raw, c.env).ok }),
    ),
  );

  app.openapi(beginSignInRoute, async (c) => {
    const { provider } = c.req.valid("param");
    const { returnTo, link } = c.req.valid("query");
    const begun = await c.var.handlers.identity.beginSignIn({
      actor: c.var.actor,
      provider,
      link: link === "1",
      redirectUri: callbackUrl(provider, c.req.url),
    });
    if (!begun.ok) return refuse(c, begun.error);
    setOAuthStateCookie(c, provider, { state: begun.value.state, linkFor: begun.value.linkFor, returnTo });
    return c.redirect(begun.value.authorizationUrl, 302);
  });

  app.openapi(signInCallbackRoute, async (c) => {
    const { provider } = c.req.valid("param");
    const { code, state, error } = c.req.valid("query");
    const started = takeOAuthStateCookie(c, provider);
    const completed = await c.var.handlers.identity.completeSignIn({
      actor: c.var.actor,
      provider,
      code,
      state,
      error,
      expectedState: started.state,
      linkFor: started.linkFor,
      redirectUri: callbackUrl(provider, c.req.url),
    });
    if (!completed.ok) return c.redirect(refusedLocation(completed.error, provider, started), 302);
    if (completed.value.mode === "signed-in") {
      setSessionCookie(c, completed.value.session.secret, completed.value.session.expiresAt);
    }
    return c.redirect(started.returnTo, 302);
  });

  app.openapi(devSignInRoute, async (c) => {
    const allowed = devSignInAllowed(c.req.raw, c.env);
    if (!allowed.ok) return refuse(c, allowed.error);
    const signedIn = await c.var.handlers.identity.devSignIn(c.req.valid("json"));
    if (!signedIn.ok) return refuse(c, signedIn.error);
    setSessionCookie(c, signedIn.value.session.secret, signedIn.value.session.expiresAt);
    return c.json(signedIn.value.me, 200);
  });

  app.openapi(signOutRoute, async (c) => {
    const secret = readSessionCookie(c);
    if (secret) await c.var.handlers.identity.signOut({ sessionSecret: secret });
    clearSessionCookie(c);
    return c.body(null, 204);
  });

  app.openapi(getMeRoute, async (c) => respond(c, await c.var.handlers.identity.getMe(c.var.actor)));
  app.openapi(updateMeRoute, async (c) =>
    respond(c, await c.var.handlers.identity.updateProfile(c.var.actor, c.req.valid("json"))),
  );
  app.openapi(setVisibilityRoute, async (c) =>
    respond(c, await c.var.handlers.identity.setVisibility(c.var.actor, c.req.valid("json"))),
  );
  app.openapi(listIdentitiesRoute, async (c) => respond(c, await c.var.handlers.identity.listIdentities(c.var.actor)));
  app.openapi(unlinkIdentityRoute, async (c) =>
    respond(c, await c.var.handlers.identity.unlinkIdentity(c.var.actor, c.req.valid("param"))),
  );
  app.openapi(listTokensRoute, async (c) => respond(c, await c.var.handlers.identity.listAgentTokens(c.var.actor)));
  app.openapi(issueTokenRoute, async (c) =>
    respond(c, await c.var.handlers.identity.issueAgentToken(c.var.actor, c.req.valid("json"))),
  );
  app.openapi(revokeTokenRoute, async (c) =>
    respond(c, await c.var.handlers.identity.revokeAgentToken(c.var.actor, c.req.valid("param"))),
  );
  app.openapi(rotateFeedRoute, async (c) => respond(c, await c.var.handlers.identity.rotateCalendarFeed(c.var.actor)));
  app.openapi(getFeedRoute, async (c) => respond(c, await c.var.handlers.identity.getCalendarFeed(c.var.actor)));
  app.openapi(getAttendeeRoute, async (c) =>
    respond(c, await c.var.handlers.identity.getAttendee(c.var.actor, c.req.valid("param"))),
  );
}

