// /mcp: streamable HTTP MCP in the same Worker as REST (ADR 0002).
//
// Transport: the SDK's WebStandardStreamableHTTPServerTransport, which takes a
// fetch Request and returns a Response, so it runs on Workers as is; the
// Node transport (StreamableHTTPServerTransport) wants Node req/res. Stateless:
// every request builds a fresh server and transport and keeps nothing, so no
// Durable Object or session store is needed. JSON responses rather than an SSE
// stream, since no tool here streams progress.
import type { Actor } from "@hallway/application";
import { GetEventInput, Event } from "@hallway/contracts";
import { Me } from "@hallway/contracts";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { ApiApp, Handlers } from "../app.ts";
import { toolResult } from "./outcome-mcp.ts";
import { registerNetworkTools } from "./network-tools.ts";
import { registerScheduleTools } from "./schedule-tools.ts";

export const serverInfo = { name: "hallway", version: "0.0.0" } as const;

export function registerMcp<B extends object>(app: ApiApp<B>) {
  app.all("/mcp", async (c) => {
    const server = mcpServer(c.var.handlers, c.var.actor);
    // No sessionIdGenerator is what makes the transport stateless.
    const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true });
    await server.connect(transport);
    return transport.handleRequest(c.req.raw);
  });
}

// A schema with a `.meta({ id })` (named for its OpenAPI component) converts
// to `{ $ref, definitions }` with no top-level `type`, and MCP requires an
// output schema's type to be "object": the SDK's own client refuses the tool
// list otherwise. A copy of the shape has no id, so it converts inline.
export const asToolOutput = <Shape extends z.ZodRawShape>(schema: z.ZodObject<Shape>) =>
  z.object(schema.shape);

function mcpServer(handlers: Handlers, actor: Actor): McpServer {
  const server = new McpServer(serverInfo);
  server.registerTool(
    "get_event",
    {
      title: "Get an event",
      description:
        "One AWS event Hallway knows about, by AWS's event id. re:Invent 2026 is `reinvent2026`. Times are ISO-8601 in the event's own timezone.",
      inputSchema: GetEventInput,
      outputSchema: asToolOutput(Event),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (input) => toolResult(await handlers.getEvent(actor, input)),
  );
  server.registerTool(
    "whoami",
    {
      title: "Who am I on Hallway",
      description:
        "The Hallway attendee your agent token acts as: handle, display name, visibility, and the name and email LinkedIn verified. Call it first to check the token works.",
      outputSchema: asToolOutput(Me),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => toolResult(await handlers.identity.getMe(actor)),
  );
  registerScheduleTools(server, handlers, actor);
  registerNetworkTools(server, handlers, actor);
  return server;
}
