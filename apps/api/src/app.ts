// The Hono app, without the adapters: index.ts (the Worker) passes handlers
// over D1, tests pass handlers over the in-memory fakes. REST routes and MCP
// tools both reach the same handlers through `c.var.handlers` (ADR 0002).
import { OpenAPIHono } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import type { Actor, GetEvent, IdentityHandlers } from "@hallway/application";
import type { NetworkHandlers, ScheduleHandlers } from "@hallway/application";
import type { SharingHandlers } from "@hallway/application";
import type { ApiError } from "@hallway/contracts";
import { readSessionCookie } from "./auth/cookies.ts";
import type { DevSignInBindings } from "./auth/dev-sign-in.ts";
import { resolveActor } from "./auth/resolve-actor.ts";
import { registerMcp } from "./mcp/server.ts";
import { httpStatus, unavailable } from "./outcome-http.ts";
import { registerDocsRoutes } from "./routes/docs.ts";
import { registerEventRoutes } from "./routes/events.ts";
import { registerIdentityRoutes } from "./routes/identity.ts";
import { registerNetworkRoutes } from "./routes/network.ts";
import { registerScheduleRoutes } from "./routes/schedule.ts";
import { registerSharingRoutes } from "./routes/sharing.ts";
import type { RenderPng } from "./sharing/png.ts";

/** Every handler the interfaces may call, built per request from the bindings. */
export interface Handlers extends ScheduleHandlers {
  getEvent: GetEvent;
  identity: IdentityHandlers;
  network: NetworkHandlers;
  sharing: SharingHandlers;
}

export interface ApiEnv<Bindings extends object> {
  Bindings: Bindings;
  Variables: { actor: Actor; handlers: Handlers };
}

export interface AppDependencies<Bindings extends object> {
  handlers: (bindings: Bindings) => Handlers;
  /** The share card's renderer: wasm on the Worker (sharing/worker-renderer.ts), from files in tests. */
  renderPng: RenderPng;
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
    if (!actor.ok) {
      // Only a bearer the caller sent is refused here (resolve-actor.ts), and
      // what it can do about that is get a new one. The header is RFC 6750's,
      // so an MCP client reports a bad token instead of starting OAuth
      // discovery (hunt F13).
      const { kind, message } = actor.error;
      c.header("WWW-Authenticate", 'Bearer realm="hallway", error="invalid_token"');
      return c.json(
        {
          kind,
          message: `${message} Ask the user for a new agent token from Hallway's Connect your agent page (/connect), sent as \`Authorization: Bearer hw_...\`.`,
        } satisfies ApiError,
        httpStatus[kind],
      );
    }
    c.set("actor", actor.value);
    await next();
  });

  registerEventRoutes(app);
  registerIdentityRoutes(app);
  registerScheduleRoutes(app);
  registerNetworkRoutes(app);
  registerSharingRoutes(app, dependencies.renderPng);
  registerMcp(app);
  registerDocsRoutes(app);

  app.doc31("/api/openapi.json", {
    openapi: "3.1.0",
    info: {
      title: "Hallway",
      version: "0.0.0",
      description: "See where the people you know will be at AWS re:Invent 2026.",
    },
  });

  // A throw no handler meant (a D1 failure, a bug) is logged here with its
  // detail and answered with the generic Error resource: the driver's text,
  // with table and column names, is for the log, not the caller (#68). MCP
  // tools catch their own, in mcp/outcome-mcp.ts.
  app.onError((error, c) => {
    // Hono's own refusals (a body that is not JSON) keep their status and text.
    if (error instanceof HTTPException) return error.getResponse();
    console.error(`${c.req.method} ${c.req.path} failed unexpectedly`, error);
    return c.json(unavailable, httpStatus.unavailable);
  });

  // Only the Worker's own paths reach here (wrangler.jsonc run_worker_first);
  // everything else is a static asset or the SPA's index.html.
  app.notFound((c) => {
    const error: ApiError = { kind: "not-found", message: `Nothing at ${c.req.path}.` };
    return c.json(error, httpStatus["not-found"]);
  });

  return app;
}
