// GetMySchedule (domain.md): my entries for one event with their sessions,
// hidden ones included and marked, because they are mine.
import type { EventScope, MySchedule } from "@hallway/contracts";
import type { Actor } from "../actor.ts";
import { fail, ok, type Outcome } from "../outcome.ts";
import type { ScheduleDependencies } from "./dependencies.ts";
import { attendeeOf, planEntryResource, signInFirst } from "./resources.ts";

export type GetMySchedule = (actor: Actor, input: EventScope) => Promise<Outcome<MySchedule>>;

export function getMySchedule({ events, schedule, sessionUrlTemplate }: ScheduleDependencies): GetMySchedule {
  return async (actor, { eventId }) => {
    const attendeeId = attendeeOf(actor);
    if (!attendeeId) return signInFirst();
    const event = await events.get(eventId);
    if (!event) return fail("not-found", `No event ${eventId}.`);
    const entries = await schedule.schedule(attendeeId, eventId);
    return ok({
      eventId,
      timezone: event.timezone,
      entries: entries.map(({ entry, session }) => planEntryResource(entry, session, sessionUrlTemplate)),
    });
  };
}
