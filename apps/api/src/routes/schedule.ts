// The schedule routes: parse with the contract, call the handler, map the
// outcome. Nothing else belongs here (ADR 0002).
import { createRoute } from "@hono/zod-openapi";
import {
  EventScope,
  MySchedule,
  PlanEntry,
  SearchSessionsQuery,
  Session,
  SessionList,
  SessionScope,
  SetEntryHiddenBody,
  SyncResult,
  SyncScheduleBody,
} from "@hallway/contracts";
import type { ApiApp } from "../app.ts";
import { errorResponses, respond } from "../outcome-http.ts";

const json = <T>(schema: T, description: string) => ({ description, content: { "application/json": { schema } } });
const body = <T>(schema: T) => ({ required: true, content: { "application/json": { schema } } });
const mySchedule = "/api/events/{eventId}/my-schedule";
const myEntry = `${mySchedule}/entries/{sessionId}`;

const syncRoute = createRoute({
  method: "put",
  path: mySchedule,
  operationId: "syncMySchedule",
  summary: "Replace my synced entries with my AWS favorites, reservations and invitations",
  description:
    "What `sync_my_schedule` does over MCP. Keeps each snapshot of a listed session as my report of it (the catalog shows what most reporters agree on), then makes my `agent-sync` entries equal the id lists and invited sessions. Manual entries and hidden sessions survive.",
  request: { params: EventScope, body: body(SyncScheduleBody) },
  responses: { 200: json(SyncResult, "What the sync did."), ...errorResponses },
});

const getMyScheduleRoute = createRoute({
  method: "get",
  path: mySchedule,
  operationId: "getMySchedule",
  summary: "My schedule for an event, hidden entries included",
  request: { params: EventScope },
  responses: { 200: json(MySchedule, "My entries, in start order."), ...errorResponses },
});

const addRoute = createRoute({
  method: "post",
  path: myEntry,
  operationId: "addToMySchedule",
  summary: "Add a catalog session to my schedule by hand",
  request: { params: SessionScope },
  responses: { 200: json(PlanEntry, "The entry, new or already there."), ...errorResponses },
});

const removeRoute = createRoute({
  method: "delete",
  path: myEntry,
  operationId: "removeFromMySchedule",
  summary: "Remove an entry I added by hand",
  description: "A synced entry is refused with 409: hide it, or drop it on AWS and sync again.",
  request: { params: SessionScope },
  responses: { 200: json(PlanEntry, "The entry that was removed."), ...errorResponses },
});

const hideRoute = createRoute({
  method: "patch",
  path: myEntry,
  operationId: "setMyEntryHidden",
  summary: "Hide or show one entry",
  request: { params: SessionScope, body: body(SetEntryHiddenBody) },
  responses: { 200: json(PlanEntry, "The entry as it now is."), ...errorResponses },
});

const searchRoute = createRoute({
  method: "get",
  path: "/api/events/{eventId}/sessions",
  operationId: "searchSessions",
  summary: "Search the session catalog",
  request: { params: EventScope, query: SearchSessionsQuery },
  responses: { 200: json(SessionList, "Matching sessions, in start order."), ...errorResponses },
});

const getSessionRoute = createRoute({
  method: "get",
  path: "/api/events/{eventId}/sessions/{sessionId}",
  operationId: "getSession",
  summary: "One catalog session",
  request: { params: SessionScope },
  responses: { 200: json(Session, "The session."), ...errorResponses },
});

export function registerScheduleRoutes<B extends object>(app: ApiApp<B>) {
  app.openapi(syncRoute, async (c) =>
    respond(c, await c.var.handlers.syncSchedule(c.var.actor, { ...c.req.valid("param"), ...c.req.valid("json") })),
  );
  app.openapi(getMyScheduleRoute, async (c) =>
    respond(c, await c.var.handlers.getMySchedule(c.var.actor, c.req.valid("param"))),
  );
  app.openapi(addRoute, async (c) => respond(c, await c.var.handlers.addToPlan(c.var.actor, c.req.valid("param"))));
  app.openapi(removeRoute, async (c) =>
    respond(c, await c.var.handlers.removeFromPlan(c.var.actor, c.req.valid("param"))),
  );
  app.openapi(hideRoute, async (c) =>
    respond(c, await c.var.handlers.setEntryHidden(c.var.actor, { ...c.req.valid("param"), ...c.req.valid("json") })),
  );
  app.openapi(searchRoute, async (c) =>
    respond(c, await c.var.handlers.searchSessions(c.var.actor, { ...c.req.valid("param"), ...c.req.valid("query") })),
  );
  app.openapi(getSessionRoute, async (c) =>
    respond(c, await c.var.handlers.getSession(c.var.actor, c.req.valid("param"))),
  );
}
