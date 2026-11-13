// GET /api/events/{eventId} and its venues: parse with the contract, call the
// handler, map the outcome. Nothing else belongs here (ADR 0002).
import { createRoute } from "@hono/zod-openapi";
import { Event, GetEventInput, Venues } from "@hallway/contracts";
import type { ApiApp } from "../app.ts";
import { errorResponses, respond } from "../outcome-http.ts";

const getEventRoute = createRoute({
  method: "get",
  path: "/api/events/{eventId}",
  operationId: "getEvent",
  summary: "One AWS event Hallway knows about",
  request: { params: GetEventInput },
  responses: {
    200: { description: "The event.", content: { "application/json": { schema: Event } } },
    ...errorResponses,
  },
});

const getVenuesRoute = createRoute({
  method: "get",
  path: "/api/events/{eventId}/venues",
  operationId: "getVenues",
  summary: "The event's venues on a map, and the walking times between them",
  request: { params: GetEventInput },
  responses: {
    200: { description: "The venues and walks.", content: { "application/json": { schema: Venues } } },
    ...errorResponses,
  },
});

export function registerEventRoutes<B extends object>(app: ApiApp<B>) {
  app.openapi(getEventRoute, async (c) =>
    respond(c, await c.var.handlers.getEvent(c.var.actor, c.req.valid("param"))),
  );
  app.openapi(getVenuesRoute, async (c) =>
    respond(c, await c.var.handlers.getVenues(c.var.actor, c.req.valid("param"))),
  );
}
