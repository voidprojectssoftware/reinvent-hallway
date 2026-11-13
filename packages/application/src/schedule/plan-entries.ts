// AddToPlan, RemoveFromPlan and SetEntryHidden (domain.md): what the attendee
// does to their own schedule on Hallway, beside what their agent syncs.
import type { PlanEntry as PlanEntryResource, SessionScope, SetEntryHiddenInput } from "@hallway/contracts";
import type { PlanEntry } from "@hallway/domain";
import type { Actor } from "../actor.ts";
import { fail, ok, type Outcome } from "../outcome.ts";
import type { ScheduleDependencies } from "./dependencies.ts";
import { attendeeOf, planEntryResource, signInFirst } from "./resources.ts";

export type AddToPlan = (actor: Actor, input: SessionScope) => Promise<Outcome<PlanEntryResource>>;
export type RemoveFromPlan = (actor: Actor, input: SessionScope) => Promise<Outcome<PlanEntryResource>>;
export type SetEntryHidden = (actor: Actor, input: SetEntryHiddenInput) => Promise<Outcome<PlanEntryResource>>;

const notInCatalog = (sessionId: string, eventId: string) =>
  fail<never>("not-found", `No session ${sessionId} in ${eventId}'s catalog. An agent has to sync it first.`);
const notOnPlan = (sessionId: string) => fail<never>("not-found", `Session ${sessionId} is not on your schedule.`);

/**
 * A `manual` entry, `interested`, for a session already in the catalog. A
 * session already on the schedule, however it got there, is returned as it is:
 * adding it again is a no-op, never a second entry.
 */
export function addToPlan({ schedule, sessionUrlTemplate, now }: ScheduleDependencies): AddToPlan {
  return async (actor, { eventId, sessionId }) => {
    const attendeeId = attendeeOf(actor);
    if (!attendeeId) return signInFirst();
    const session = await schedule.session(eventId, sessionId);
    if (!session) return notInCatalog(sessionId, eventId);
    let entry = await schedule.entry(attendeeId, eventId, sessionId);
    if (!entry) {
      const added: PlanEntry = {
        attendeeId,
        sessionId,
        intent: "interested",
        source: "manual",
        hidden: false,
        addedAt: now().toISOString(),
      };
      await schedule.addEntry(eventId, added);
      entry = added;
    }
    return ok(planEntryResource(entry, session, sessionUrlTemplate));
  };
}

/**
 * Removes a `manual` entry. An `agent-sync` entry is refused: the next sync
 * would put it straight back, so the attendee is told to hide it here or drop
 * it on AWS instead.
 */
export function removeFromPlan({ schedule, sessionUrlTemplate }: ScheduleDependencies): RemoveFromPlan {
  return async (actor, { eventId, sessionId }) => {
    const attendeeId = attendeeOf(actor);
    if (!attendeeId) return signInFirst();
    const entry = await schedule.entry(attendeeId, eventId, sessionId);
    const session = entry && (await schedule.session(eventId, sessionId));
    if (!entry || !session) return notOnPlan(sessionId);
    if (entry.source === "agent-sync") {
      return fail(
        "conflict",
        `Session ${sessionId} came from your AWS schedule, so the next sync would bring it back. Hide it here, or remove it from your AWS favorites or reservations and sync again.`,
      );
    }
    await schedule.removeEntry(attendeeId, eventId, sessionId);
    return ok(planEntryResource(entry, session, sessionUrlTemplate));
  };
}

export function setEntryHidden({ schedule, sessionUrlTemplate }: ScheduleDependencies): SetEntryHidden {
  return async (actor, { eventId, sessionId, hidden }) => {
    const attendeeId = attendeeOf(actor);
    if (!attendeeId) return signInFirst();
    const entry = await schedule.entry(attendeeId, eventId, sessionId);
    const session = entry && (await schedule.session(eventId, sessionId));
    if (!entry || !session) return notOnPlan(sessionId);
    if (entry.hidden !== hidden) await schedule.setHidden(attendeeId, eventId, sessionId, hidden);
    return ok(planEntryResource({ ...entry, hidden }, session, sessionUrlTemplate));
  };
}
