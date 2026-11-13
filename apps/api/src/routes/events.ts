// GET /api/events/{eventId}: parse with the contract, call GetEvent, map the
// outcome. Nothing else belongs here (ADR 0002).
import { createRoute } from "@hono/zod-openapi";
import { Event, GetEventInput } from "@hallway/contracts";
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

export function registerEventRoutes<B extends object>(app: ApiApp<B>) {
  app.openapi(getEventRoute, async (c) =>
    respond(c, await c.var.handlers.getEvent(c.var.actor, c.req.valid("param"))),
  );
}
