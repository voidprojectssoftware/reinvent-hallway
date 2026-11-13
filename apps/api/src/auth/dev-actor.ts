// A STAND-IN for sign-in, until the identity issue lands real sessions and
// agent tokens and replaces this file. It turns `Authorization: Bearer
// dev:<attendeeId>` into that attendee, believed without proof.
//
// Two holds keep it local:
// 1. It is on only when DEV_SIGN_IN is "1", which comes from apps/api/.dev.vars
//    (git-ignored, copied from .dev.vars.example by scripts/dev.mjs) and never
//    from wrangler.jsonc.
// 2. Even then it refuses a request whose host is not loopback, so a stray var
//    on a deployed Worker, reached only on its routed hostname, opens nothing.
//
// No Authorization header is the anonymous actor. A bearer token this cannot
// honour is refused rather than treated as anonymous, so a caller with a bad
// token learns it instead of silently seeing less.
import { anonymous, fail, ok, type Actor, type Outcome } from "@hallway/application";

export interface DevSignInBindings {
  DEV_SIGN_IN?: string;
}

const devToken = /^Bearer dev:([A-Za-z0-9_-]{1,64})$/;

export function resolveDevActor(request: Request, bindings: DevSignInBindings): Outcome<Actor> {
  const header = request.headers.get("authorization");
  if (header === null) return ok(anonymous);
  if (bindings.DEV_SIGN_IN !== "1") {
    return fail("unauthenticated", "Agent tokens are not built yet; only dev sign-in exists.");
  }
  if (!isLoopback(new URL(request.url).hostname)) {
    return fail("unauthenticated", "Dev sign-in answers only on a loopback host.");
  }
  const match = devToken.exec(header);
  if (!match?.[1]) {
    return fail("unauthenticated", "Expected `Authorization: Bearer dev:<attendeeId>`.");
  }
  return ok({ kind: "attendee", attendeeId: match[1] });
}

function isLoopback(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    /^127\.\d+\.\d+\.\d+$/.test(hostname) ||
    hostname === "[::1]"
  );
}
