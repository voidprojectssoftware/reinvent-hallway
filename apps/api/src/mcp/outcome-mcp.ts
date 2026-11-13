// The one place a handler outcome becomes an MCP tool result (ADR 0002). A
// refusal is a tool error (`isError`), not a protocol error, so the agent sees
// why and can act on it; its text is the same Error resource REST returns.
//
// Every tool's handler call runs inside `toolResult`, so this is also
// the one place an unexpected failure is caught (#68). Left alone, the SDK
// would hand the agent the exception's own text: for D1, the driver's message
// with table and column names, which says nothing about what to do next.
import type { Outcome } from "@hallway/application";
import type { ApiError } from "@hallway/contracts";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { unavailable } from "../outcome-http.ts";

/**
 * Over MCP an unauthenticated refusal always means the connection carries no
 * token (a wrong or revoked token is refused before any tool runs, app.ts),
 * and an agent cannot sign in. So it is told the one thing that helps.
 */
const noToken: ApiError = {
  kind: "unauthenticated",
  message:
    "This MCP connection has no Hallway agent token, so Hallway does not know who you act for. Ask the user to create one on Hallway's Connect your agent page (/connect) and add it to this server's configuration as the header `Authorization: Bearer hw_...`.",
};

const errorResult = (error: ApiError): CallToolResult => ({
  isError: true,
  content: [{ type: "text", text: JSON.stringify(error) }],
});

/** Runs one tool's handler call; `run` is a function so a throw before its promise is caught too. */
export async function toolResult<T extends Record<string, unknown>>(
  run: () => Promise<Outcome<T>>,
): Promise<CallToolResult> {
  let outcome: Outcome<T>;
  try {
    outcome = await run();
  } catch (error) {
    // The detail stays in the Worker's log, where it can be read; the agent
    // gets a message it can act on.
    console.error("MCP tool failed unexpectedly", error);
    return errorResult(unavailable);
  }
  if (!outcome.ok) return errorResult(outcome.error.kind === "unauthenticated" ? noToken : outcome.error);
  return {
    structuredContent: outcome.value,
    content: [{ type: "text", text: JSON.stringify(outcome.value) }],
  };
}
