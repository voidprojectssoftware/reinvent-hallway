// Sign-in, sign-out, me, agent tokens, calendar feed and attendee cards. Each
// route parses with the contract, calls one identity handler and maps its
// outcome (ADR 0002). The only extra work here is HTTP's own: reading and
// setting cookies, and redirecting the browser to and from LinkedIn.
import { createRoute, z } from "@hono/zod-openapi";
import {
  AgentToken,
  AgentTokenList,
  AttendeeCard,
  CalendarFeed,
  DevSignInInput,
  GetAttendeeInput,
  IssueAgentTokenInput,
  IssuedAgentToken,
  Me,
  RevokeAgentTokenInput,
  SetVisibilityInput,
  UpdateProfileInput,
} from "@hallway/contracts";
import type { ApiApp } from "../app.ts";
import {
  clearSessionCookie,
  linkedInCallbackPath,
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

const beginLinkedIn = createRoute({
  method: "get",
  path: "/api/auth/linkedin",
  operationId: "beginLinkedInSignIn",
  summary: "Start Sign In with LinkedIn: redirects to LinkedIn with a state bound to this browser",
  tags,
  responses: { 302: redirect("To LinkedIn's consent page."), ...errorResponses },
});

const linkedInCallback = createRoute({
  method: "get",
  path: linkedInCallbackPath,
  operationId: "completeLinkedInSignIn",
  summary: "LinkedIn's redirect back: checks the state, signs in, sets the session cookie",
  tags,
  request: {
    query: z.object({
      code: z.string().optional(),
      state: z.string().optional(),
      error: z.string().optional(),
      error_description: z.string().optional(),
    }),
  },
  responses: { 302: redirect("Signed in; to the web app."), ...errorResponses },
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
  summary: "My agent tokens, revoked ones included. Never their secrets",
  tags,
  responses: { 200: json("My tokens.", AgentTokenList), ...errorResponses },
});

const issueTokenRoute = createRoute({
  method: "post",
  path: "/api/me/tokens",
  operationId: "issueAgentToken",
  summary: "Issue an agent token. The secret is in this response and never again",
  tags,
  request: body(IssueAgentTokenInput),
  responses: { 200: json("The token and its secret.", IssuedAgentToken), ...errorResponses },
});

const revokeTokenRoute = createRoute({
  method: "delete",
  path: "/api/me/tokens/{tokenId}",
  operationId: "revokeAgentToken",
  summary: "Revoke one of my agent tokens",
  tags,
  request: { params: RevokeAgentTokenInput },
  responses: { 200: json("The token, revoked.", AgentToken), ...errorResponses },
});

const rotateFeedRoute = createRoute({
  method: "post",
  path: "/api/me/calendar-feed/rotate",
  operationId: "rotateCalendarFeed",
  summary: "Make a new secret calendar feed URL; the old one stops working",
  tags,
  responses: { 200: json("The new feed. Its token is shown once.", CalendarFeed), ...errorResponses },
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

export function registerIdentityRoutes<B extends DevSignInBindings>(app: ApiApp<B>) {
  const callbackUrl = (requestUrl: string) => new URL(linkedInCallbackPath, requestUrl).toString();

  app.openapi(beginLinkedIn, async (c) => {
    const begun = await c.var.handlers.identity.beginLinkedInSignIn({ redirectUri: callbackUrl(c.req.url) });
    if (!begun.ok) return refuse(c, begun.error);
    setOAuthStateCookie(c, begun.value.state);
    return c.redirect(begun.value.authorizationUrl, 302);
  });

  app.openapi(linkedInCallback, async (c) => {
    const { code, state, error } = c.req.valid("query");
    const signedIn = await c.var.handlers.identity.completeLinkedInSignIn({
      code,
      state,
      error,
      expectedState: takeOAuthStateCookie(c),
      redirectUri: callbackUrl(c.req.url),
    });
    if (!signedIn.ok) return refuse(c, signedIn.error);
    setSessionCookie(c, signedIn.value.session.secret, signedIn.value.session.expiresAt);
    return c.redirect("/", 302);
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
  app.openapi(listTokensRoute, async (c) => respond(c, await c.var.handlers.identity.listAgentTokens(c.var.actor)));
  app.openapi(issueTokenRoute, async (c) =>
    respond(c, await c.var.handlers.identity.issueAgentToken(c.var.actor, c.req.valid("json"))),
  );
  app.openapi(revokeTokenRoute, async (c) =>
    respond(c, await c.var.handlers.identity.revokeAgentToken(c.var.actor, c.req.valid("param"))),
  );
  app.openapi(rotateFeedRoute, async (c) => respond(c, await c.var.handlers.identity.rotateCalendarFeed(c.var.actor)));
  app.openapi(getAttendeeRoute, async (c) =>
    respond(c, await c.var.handlers.identity.getAttendee(c.var.actor, c.req.valid("param"))),
  );
}

