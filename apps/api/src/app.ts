// The Hono app, without the adapters: index.ts (the Worker) passes handlers
// over D1, tests pass handlers over the in-memory fakes. REST routes and MCP
// tools both reach the same handlers through `c.var.handlers` (ADR 0002).
import { OpenAPIHono } from "@hono/zod-openapi";
import type { Actor, GetEvent, IdentityHandlers } from "@hallway/application";
import type { NetworkHandlers, ScheduleHandlers } from "@hallway/application";
import type { ApiError } from "@hallway/contracts";
import { readSessionCookie } from "./auth/cookies.ts";
import type { DevSignInBindings } from "./auth/dev-sign-in.ts";
import { resolveActor } from "./auth/resolve-actor.ts";
import { registerMcp } from "./mcp/server.ts";
import { httpStatus } from "./outcome-http.ts";
import { registerEventRoutes } from "./routes/events.ts";
import { registerIdentityRoutes } from "./routes/identity.ts";
import { registerNetworkRoutes } from "./routes/network.ts";
import { registerScheduleRoutes } from "./routes/schedule.ts";

/** Every handler the interfaces may call, built per request from the bindings. */
export interface Handlers extends ScheduleHandlers {
  getEvent: GetEvent;
  identity: IdentityHandlers;
  network: NetworkHandlers;
}

export interface ApiEnv<Bindings extends object> {
  Bindings: Bindings;
  Variables: { actor: Actor; handlers: Handlers };
}

export interface AppDependencies<Bindings extends object> {
  handlers: (bindings: Bindings) => Handlers;
}

export type ApiApp<Bindings extends object = DevSignInBindings> = OpenAPIHono<ApiEnv<Bindings>>;

export function createApp<Bindings extends DevSignInBindings>(
  dependencies: AppDependencies<Bindings>,
): ApiApp<Bindings> {
  const app: ApiApp<Bindings> = new OpenAPIHono<ApiEnv<Bindings>>({
    // A request the contract refuses is the handler outcome "invalid", so it
    // reads the same as any other refusal.
    defaultHook: (result, c) => {
      if (!result.success) {
        const error: ApiError = { kind: "invalid", message: result.error.message };
        return c.json(error, httpStatus.invalid);
      }
      return undefined;
    },
  });

  app.use("*", async (c, next) => {
    c.set("handlers", dependencies.handlers(c.env));
    const actor = await resolveActor(c.req.raw, c.env, readSessionCookie(c), c.var.handlers.identity.authenticate);
    if (!actor.ok) return c.json(actor.error, httpStatus[actor.error.kind]);
    c.set("actor", actor.value);
    await next();
  });

  registerEventRoutes(app);
  registerIdentityRoutes(app);
  registerScheduleRoutes(app);
  registerNetworkRoutes(app);
  registerMcp(app);

  app.doc31("/api/openapi.json", {
    openapi: "3.1.0",
    info: {
      title: "Hallway",
      version: "0.0.0",
      description: "See where the people you know will be at AWS re:Invent 2026.",
    },
  });

  // Only the Worker's own paths reach here (wrangler.jsonc run_worker_first);
  // everything else is a static asset or the SPA's index.html.
  app.notFound((c) => {
    const error: ApiError = { kind: "not-found", message: `Nothing at ${c.req.path}.` };
    return c.json(error, httpStatus["not-found"]);
  });

  return app;
}
