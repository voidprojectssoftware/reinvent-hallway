import type { Connection, ConnectionRequest, ConnectionVia } from "./types";

// domain.md "A connection is mutual and needs consent": a request becomes a
// connection only when its recipient accepts; a share link is consent from
// both sides at once (the owner shared it, the viewer clicked Connect).

export type RequestDecision = "accept" | "decline" | "withdraw";

export type RequestOutcome =
  | { ok: true; request: ConnectionRequest; connection?: Connection }
  | { ok: false; error: "not-pending" | "not-allowed" };

/** The pair as stored: the lower id first, so a pair has one spelling. */
export function connectionBetween(
  one: string,
  other: string,
  via: ConnectionVia,
  since: string,
): Connection {
  const [a, b] = one < other ? [one, other] : [other, one];
  return { a, b, since, via };
}

/**
 * Who may do what to a pending request: the recipient accepts or declines,
 * the sender withdraws. Accepting yields the connection.
 */
export function decideRequest(
  request: ConnectionRequest,
  actorId: string,
  decision: RequestDecision,
  at: string,
): RequestOutcome {
  if (request.status !== "pending") return { ok: false, error: "not-pending" };
  const allowed = decision === "withdraw" ? actorId === request.from : actorId === request.to;
  if (!allowed) return { ok: false, error: "not-allowed" };

  const status = ({ accept: "accepted", decline: "declined", withdraw: "withdrawn" } as const)[decision];
  const decided = { ...request, status };
  if (decision !== "accept") return { ok: true, request: decided };
  return { ok: true, request: decided, connection: connectionBetween(request.from, request.to, "request", at) };
}
