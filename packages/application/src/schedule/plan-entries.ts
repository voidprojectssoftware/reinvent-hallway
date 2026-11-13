// AddToPlan, RemoveFromPlan and SetEntryHidden (domain.md): what the attendee
// does to their own schedule on Hallway, beside what their agent syncs.
import type { PlanEntry as PlanEntryResource, SessionScope, SetEntryHiddenInput } from "@hallway/contracts";
import { foldText, manualIntent, type PlanEntry } from "@hallway/domain";
import type { Actor } from "../actor.ts";
import { fail, ok, type Outcome } from "../outcome.ts";
import type { ScheduleDependencies } from "./dependencies.ts";
import { attendeeOf, planEntryResource, signInFirst } from "./resources.ts";
import type { CatalogSession, ScheduleRepository } from "./schedule-repository.ts";

export type AddToPlan = (actor: Actor, input: SessionScope) => Promise<Outcome<PlanEntryResource>>;
export type RemoveFromPlan = (actor: Actor, input: SessionScope) => Promise<Outcome<PlanEntryResource>>;
export type SetEntryHidden = (actor: Actor, input: SetEntryHiddenInput) => Promise<Outcome<PlanEntryResource>>;

const notInCatalog = (sessionId: string, eventId: string) =>
  fail<never>(
    "not-found",
    `No session with id or code ${sessionId} in ${eventId}'s catalog. Search the catalog by code, title or speaker (search_sessions) and use the sessionId it gives; a session no attendee's agent has synced yet is not in the catalog.`,
  );
const notOnPlan = (sessionId: string) =>
  fail<never>("not-found", `Session ${sessionId} is not on your schedule. Your schedule (get_my_schedule) lists what is.`);

/**
 * The catalog session a caller means: by AWS's id, or else by its code when
 * exactly one session carries it. People read codes off the catalog
 * ("AIM3315") and agents pass what they are told (hunt F10).
 */
async function sessionByIdOrCode(
  schedule: ScheduleRepository,
  eventId: string,
  idOrCode: string,
): Promise<CatalogSession | undefined> {
  const byId = await schedule.session(eventId, idOrCode);
  if (byId) return byId;
  const code = foldText(idOrCode.trim());
  const { sessions } = await schedule.searchSessions(eventId, { q: code, limit: 50 });
  const matches = sessions.filter((session) => session.code !== undefined && foldText(session.code) === code);
  return matches.length === 1 ? matches[0] : undefined;
}

/**
 * A `manual` entry, `interested`, for a session already in the catalog. A
 * session already on the schedule, however it got there, is returned as it is:
 * adding it again is a no-op, never a second entry.
 */
export function addToPlan({ schedule, sessionUrlTemplate, now }: ScheduleDependencies): AddToPlan {
  return async (actor, { eventId, sessionId: asked }) => {
    const attendeeId = attendeeOf(actor);
    if (!attendeeId) return signInFirst();
    const session = await sessionByIdOrCode(schedule, eventId, asked);
    if (!session) return notInCatalog(asked, eventId);
    const { sessionId } = session;
    let entry = await schedule.entry(attendeeId, eventId, sessionId);
    if (!entry) {
      const added: PlanEntry = {
        attendeeId,
        sessionId,
        intent: manualIntent,
        source: "manual",
        invited: false,
        hidden: false,
        addedAt: now().toISOString(),
      };
      await schedule.addEntry(eventId, added);
      // Read back: a sync landing between the read above and the add wins,
      // and the attendee is shown the entry that is actually there.
      entry = (await schedule.entry(attendeeId, eventId, sessionId)) ?? added;
    }
    return ok(planEntryResource(entry, session, sessionUrlTemplate));
  };
}

/**
 * Removes a `manual` entry. An `agent-sync` entry is refused: the next sync
 * would put it straight back, so the attendee is told to hide it here or drop
 * it on AWS instead. Like adding, it takes a session's id or its code.
 */
export function removeFromPlan({ schedule, sessionUrlTemplate }: ScheduleDependencies): RemoveFromPlan {
  return async (actor, { eventId, sessionId: asked }) => {
    const attendeeId = attendeeOf(actor);
    if (!attendeeId) return signInFirst();
    const session = await sessionByIdOrCode(schedule, eventId, asked);
    const entry = session && (await schedule.entry(attendeeId, eventId, session.sessionId));
    if (!entry || !session) return notOnPlan(asked);
    const { sessionId } = session;
    if (entry.source === "agent-sync") {
      return fail(
        "conflict",
        `Session ${sessionId} came from your AWS schedule, so the next sync would bring it back. Hide it instead (set_entry_hidden, or Hide on your Hallway schedule): it stays yours and no one else sees it. Or remove it from your AWS favorites or reservations and sync again.`,
      );
    }
    await schedule.removeEntry(attendeeId, eventId, sessionId);
    return ok(planEntryResource(entry, session, sessionUrlTemplate));
  };
}

export function setEntryHidden({ schedule, sessionUrlTemplate }: ScheduleDependencies): SetEntryHidden {
  return async (actor, { eventId, sessionId: asked, hidden }) => {
    const attendeeId = attendeeOf(actor);
    if (!attendeeId) return signInFirst();
    const session = await sessionByIdOrCode(schedule, eventId, asked);
    const entry = session && (await schedule.entry(attendeeId, eventId, session.sessionId));
    if (!entry || !session) return notOnPlan(asked);
    const { sessionId } = session;
    if (entry.hidden !== hidden) await schedule.setHidden(attendeeId, eventId, sessionId, hidden);
    return ok(planEntryResource({ ...entry, hidden }, session, sessionUrlTemplate));
  };
}
