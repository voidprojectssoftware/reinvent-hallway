// Who is asking, for every request to /api and /mcp (ADR 0002, "Auth is a
// port"). Three doors, one Actor:
//
// - `Authorization: Bearer hw_...`, an agent token: refused if unknown or
//   revoked. An agent sent a token on purpose and should learn it failed.
// - `Authorization: Bearer dev:<attendeeId>`: believed, only where dev
//   sign-in is allowed (dev-sign-in.ts). Any other bearer is refused.
// - The session cookie: an ended or unknown session is anonymous, not an
//   error, so a browser with a stale cookie still loads public pages.
//
// A bearer wins over a cookie. No credential at all is anonymous.
import {
  agentTokenPrefix,
  anonymous,
  fail,
  ok,
  type Actor,
  type IdentityHandlers,
  type Outcome,
} from "@hallway/application";
import { devSignInAllowed, type DevSignInBindings } from "./dev-sign-in.ts";

const devBearer = /^dev:([A-Za-z0-9_-]{1,64})$/;

export async function resolveActor(
  request: Request,
  bindings: DevSignInBindings,
  sessionSecret: string | undefined,
  authenticate: IdentityHandlers["authenticate"],
): Promise<Outcome<Actor>> {
  const header = request.headers.get("authorization");
  if (header !== null) {
    const bearer = /^Bearer (\S+)$/.exec(header)?.[1] ?? "";
    if (bearer.startsWith(agentTokenPrefix)) return authenticate({ kind: "agent-token", secret: bearer });
    const dev = devBearer.exec(bearer);
    if (dev?.[1]) {
      const allowed = devSignInAllowed(request, bindings);
      if (!allowed.ok) return fail("unauthenticated", allowed.error.message);
      return ok({ kind: "attendee", attendeeId: dev[1], via: "dev" });
    }
    return fail("unauthenticated", "Expected `Authorization: Bearer hw_...`, an agent token from /api/me/tokens.");
  }

  if (sessionSecret) {
    const actor = await authenticate({ kind: "session", secret: sessionSecret });
    return actor.ok ? actor : ok(anonymous);
  }
  return ok(anonymous);
}
