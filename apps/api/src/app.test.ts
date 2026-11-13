// The app over the in-memory fake, driven through its two interfaces: REST
// with plain requests, MCP with the SDK's own client. The point of the
// skeleton is that both reach one handler, so both must give the same data.
import { describe, expect, it } from "vitest";
import { getEvent, identityHandlers } from "@hallway/application";
import { eventsInMemory, identityInMemory, reinvent2026 } from "@hallway/infrastructure";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createApp } from "./app.ts";

const bindings = { DEV_SIGN_IN: "1" };
const app = createApp<typeof bindings>({
  handlers: () => ({
    getEvent: getEvent(eventsInMemory([reinvent2026])),
    identity: identityHandlers(identityInMemory()),
  }),
});
const origin = "http://127.0.0.1:8787";
const call = async (input: string | URL | Request, init?: RequestInit) =>
  app.fetch(new Request(input, init), bindings);

async function mcpClient() {
  const client = new Client({ name: "app-test", version: "0.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL("/mcp", origin), { fetch: call }));
  return client;
}

describe("GET /api/events/{eventId}", () => {
  it("returns the event", async () => {
    const response = await call(`${origin}/api/events/reinvent2026`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(reinvent2026);
  });

  it("answers 404 with the Error resource for an unknown event", async () => {
    const response = await call(`${origin}/api/events/summit-nowhere`);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ kind: "not-found", message: "No event summit-nowhere." });
  });

  it("answers 400 when the id breaks the contract", async () => {
    const response = await call(`${origin}/api/events/${"x".repeat(129)}`);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ kind: "invalid" });
  });
});

describe("MCP get_event", () => {
  it("lists the tool with the contract's input schema", async () => {
    const client = await mcpClient();
    const { tools } = await client.listTools();
    const tool = tools.find((candidate) => candidate.name === "get_event");
    expect(tool?.inputSchema).toMatchObject({ required: ["eventId"] });
    await client.close();
  });

  it("returns the same event REST does", async () => {
    const client = await mcpClient();
    const result = await client.callTool({ name: "get_event", arguments: { eventId: "reinvent2026" } });
    const rest = await (await call(`${origin}/api/events/reinvent2026`)).json();
    expect(result.structuredContent).toEqual(rest);
    await client.close();
  });

  it("returns a tool error carrying the Error resource for an unknown event", async () => {
    const client = await mcpClient();
    const result = await client.callTool({ name: "get_event", arguments: { eventId: "summit-nowhere" } });
    expect(result.isError).toBe(true);
    expect(result.content).toEqual([
      { type: "text", text: JSON.stringify({ kind: "not-found", message: "No event summit-nowhere." }) },
    ]);
    await client.close();
  });
});

describe("GET /api/openapi.json", () => {
  it("names the route and its schemas", async () => {
    const document = (await (await call(`${origin}/api/openapi.json`)).json()) as {
      paths: Record<string, unknown>;
      components: { schemas: Record<string, unknown> };
    };
    // Each slice adds its own; this test holds the skeleton's to staying named.
    expect(Object.keys(document.paths)).toContain("/api/events/{eventId}");
    expect(Object.keys(document.components.schemas)).toEqual(expect.arrayContaining(["Error", "Event"]));
  });
});

describe("unknown paths", () => {
  it("answer 404 with the Error resource", async () => {
    const response = await call(`${origin}/api/nothing-here`);
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ kind: "not-found" });
  });
});
