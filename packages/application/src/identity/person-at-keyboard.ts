// The guard for handlers that manage credentials: agent tokens, the
// calendar feed (ADR 0008), the share link's invite token and the identities
// one signs in with (ADR 0018). They need a person signed in on the web (or dev
// sign-in), not an agent token. Otherwise a stolen token could mint a fresh
// token, or read the feed URL, and keep access after its own revocation.
import type { Actor } from "../actor.ts";
import { fail, ok, type Outcome } from "../outcome.ts";

/** The signed-in person's attendee id, or the refusal: 401 if anonymous, 403 for an agent token. */
export function personAtKeyboard(actor: Actor): Outcome<string> {
  if (actor.kind !== "attendee") return fail("unauthenticated", "Sign in first.");
  if (actor.via === "agent-token") {
    return fail("forbidden", "Agent tokens cannot manage tokens, the calendar feed or the invite link. Sign in on the web to do this.");
  }
  return ok(actor.attendeeId);
}
