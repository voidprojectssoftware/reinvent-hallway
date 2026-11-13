// Domain values to contract resources, and the checks every schedule handler
// shares. The one place a session gains its `url` (domain.md "Session link").
import type { PlanEntry as PlanEntryResource, Session as SessionResource } from "@hallway/contracts";
import { sessionUrl, type PlanEntry } from "@hallway/domain";
import type { Actor } from "../actor.ts";
import { fail, type Outcome } from "../outcome.ts";
import type { CatalogSession } from "./schedule-repository.ts";

export function sessionResource(session: CatalogSession, urlTemplate: string): SessionResource {
  return session.code === undefined ? { ...session } : { ...session, url: sessionUrl(session.code, urlTemplate) };
}

export function planEntryResource(entry: PlanEntry, session: CatalogSession, urlTemplate: string): PlanEntryResource {
  return {
    sessionId: entry.sessionId,
    intent: entry.intent,
    source: entry.source,
    hidden: entry.hidden,
    addedAt: entry.addedAt,
    session: sessionResource(session, urlTemplate),
  };
}

/** Whose schedule a "my schedule" handler works on: the signed-in attendee's, or no one's. */
export const attendeeOf = (actor: Actor): string | undefined =>
  actor.kind === "attendee" ? actor.attendeeId : undefined;

/** The refusal every "my schedule" handler gives an anonymous caller. */
export const signInFirst = <T>(): Outcome<T> => fail("unauthenticated", "Sign in to have a schedule.");
