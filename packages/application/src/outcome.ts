// What every handler returns (ADR 0002): a value, or a refusal with a kind.
// Handlers never speak HTTP or MCP; apps/api maps a kind to a status in one
// place for REST (outcome-http.ts) and one for MCP (mcp/outcome-mcp.ts).
import type { ErrorKind } from "@hallway/contracts";

export type Outcome<T> =
  | { ok: true; value: T }
  | { ok: false; error: { kind: ErrorKind; message: string } };

export const ok = <T>(value: T): Outcome<T> => ({ ok: true, value });

export const fail = <T = never>(kind: ErrorKind, message: string): Outcome<T> => ({
  ok: false,
  error: { kind, message },
});
