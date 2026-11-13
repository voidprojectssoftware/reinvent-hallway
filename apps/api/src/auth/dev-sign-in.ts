// Dev sign-in (ADR 0004): `POST /api/dev/sign-in { name }`, and the older
// `Authorization: Bearer dev:<attendeeId>` that the skeleton started with and
// later slices' curl evidence still uses. Both believe the caller without
// proof, so two holds keep them local:
// 1. DEV_SIGN_IN must be "1", which comes from apps/api/.dev.vars (git-ignored,
//    copied from .dev.vars.example by scripts/dev.mjs) and never from
//    wrangler.jsonc.
// 2. Even then the request's host must be loopback, so a stray var on a
//    deployed Worker, reached only on its routed hostname, opens nothing.
import { fail, ok, type Outcome } from "@hallway/application";

export interface DevSignInBindings {
  DEV_SIGN_IN?: string;
}

/** Whether dev sign-in may be used on this request, and if not, why. */
export function devSignInAllowed(request: Request, bindings: DevSignInBindings): Outcome<true> {
  if (bindings.DEV_SIGN_IN !== "1") return fail("not-found", "Dev sign-in is off (DEV_SIGN_IN is not 1).");
  if (!isLoopback(new URL(request.url).hostname)) {
    return fail("not-found", "Dev sign-in answers only on a loopback host.");
  }
  return ok(true);
}

export function isLoopback(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    /^127\.\d+\.\d+\.\d+$/.test(hostname) ||
    hostname === "[::1]"
  );
}
