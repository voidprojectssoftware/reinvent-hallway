// The one place a handler outcome becomes an MCP tool result (ADR 0002). A
// refusal is a tool error (`isError`), not a protocol error, so the agent sees
// why and can act on it; its text is the same Error resource REST returns.
import type { Outcome } from "@hallway/application";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export function toolResult<T extends Record<string, unknown>>(outcome: Outcome<T>): CallToolResult {
  if (!outcome.ok) {
    return { isError: true, content: [{ type: "text", text: JSON.stringify(outcome.error) }] };
  }
  return {
    structuredContent: outcome.value,
    content: [{ type: "text", text: JSON.stringify(outcome.value) }],
  };
}
