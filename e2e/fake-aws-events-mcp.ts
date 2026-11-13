// A stand-in for the AWS Events MCP server (docs/discovery/aws-events-api.md),
// serving one attendee's schedule from a fixture, in process.
//
// Its tool list is built from the committed spec, not written by hand: each
// tool's `inputSchema` is the operation's path parameters and its
// `outputSchema` is the operation's 200 response, with `$ref`s inlined. The
// MCP SDK client validates every `structuredContent` against the advertised
// `outputSchema`, so a fixture that drifts from AWS's shapes fails the agent's
// call here, the way it would fail against the real server.
import { readFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

type Json = { [key: string]: unknown };

interface OpenApi {
  paths: Record<string, Record<string, { operationId: string; parameters?: { name: string; in: string; schema: Json; required?: boolean }[]; responses: Record<string, { content?: Record<string, { schema: Json }> }> }>>;
  components: { schemas: Record<string, Json> };
}

/** What the fixture files hold: `GetSchedule`'s `schedule` and every `GetSession`'s `session`. */
export interface AwsScheduleFixture {
  schedule: { reserved: string[]; favorites: string[]; personalTime: unknown[] };
  sessions: ({ sessionId: string } & Json)[];
}

const spec: OpenApi = JSON.parse(
  readFileSync(new URL("../docs/discovery/aws-events-api/openapi-2026-11-13.json", import.meta.url), "utf8"),
);

function inline(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(inline);
  if (schema === null || typeof schema !== "object") return schema;
  const ref = (schema as Json).$ref;
  if (typeof ref === "string") return inline(spec.components.schemas[ref.replace("#/components/schemas/", "")]);
  return Object.fromEntries(Object.entries(schema).map(([key, value]) => [key, inline(value)]));
}

function toolFromSpec(path: string) {
  const operation = spec.paths[path]!.get!;
  const pathParams = (operation.parameters ?? []).filter((parameter) => parameter.in === "path");
  return {
    name: operation.operationId,
    inputSchema: {
      type: "object" as const,
      properties: Object.fromEntries(pathParams.map((parameter) => [parameter.name, parameter.schema])),
      required: pathParams.map((parameter) => parameter.name),
    },
    outputSchema: inline(operation.responses["200"]!.content!["application/json"]!.schema) as { type: "object" },
  };
}

const tools = [
  toolFromSpec("/v1/events/{eventId}/schedule"),
  toolFromSpec("/v1/events/{eventId}/sessions/{sessionId}"),
];

function serve(fixture: AwsScheduleFixture): Server {
  const server = new Server({ name: "fake-aws-events", version: "0.0.0" }, { capabilities: { tools: {} } });
  const sessions = new Map(fixture.sessions.map((session) => [session.sessionId, session]));
  const answer = (structuredContent: Json) => ({
    content: [{ type: "text" as const, text: JSON.stringify(structuredContent) }],
    structuredContent,
  });
  const refuse = (message: string) => ({ content: [{ type: "text" as const, text: JSON.stringify({ message }) }], isError: true });

  server.setRequestHandler(ListToolsRequestSchema, () => ({ tools }));
  server.setRequestHandler(CallToolRequestSchema, ({ params }) => {
    const args = (params.arguments ?? {}) as { eventId?: string; sessionId?: string };
    if (args.eventId !== "reinvent2026") return refuse(`Event ${args.eventId} not found.`);
    if (params.name === "GetSchedule") return answer({ schedule: fixture.schedule });
    if (params.name === "GetSession") {
      const session = sessions.get(args.sessionId ?? "");
      return session ? answer({ session }) : refuse(`Session ${args.sessionId} not found.`);
    }
    return refuse(`Unknown tool ${params.name}.`);
  });
  return server;
}

/** A connected client of a fresh fake server for one attendee's AWS account. */
export async function connectFakeAwsEvents(fixture: AwsScheduleFixture): Promise<Client> {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await serve(fixture).connect(serverSide);
  const client = new Client({ name: "scripted-agent", version: "0.0.0" });
  await client.connect(clientSide);
  return client;
}
