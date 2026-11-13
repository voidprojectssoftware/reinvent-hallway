// GetMySchedule (domain.md): my entries for one event with their sessions,
// hidden ones included and marked, because they are mine, and what my agent's
// last sync did, so I can trust the page shows what it last sent. Whether I
// read abstracts yet comes with it (issue #88): a screen showing no
// description can then say whether I am waiting for another attendee to
// corroborate mine (ADR 0025) or the session simply has none.
import type { EventScope, MySchedule } from "@hallway/contracts";
import { canReadAbstract } from "@hallway/domain";
import type { Actor } from "../actor.ts";
import { noEvent } from "../events/get-event.ts";
import { fail, ok, type Outcome } from "../outcome.ts";
import type { ScheduleDependencies } from "./dependencies.ts";
import { attendeeOf, planEntryResource, signInFirst } from "./resources.ts";

export type GetMySchedule = (actor: Actor, input: EventScope) => Promise<Outcome<MySchedule>>;

export function getMySchedule({ events, schedule, sessionUrlTemplate }: ScheduleDependencies): GetMySchedule {
  return async (actor, { eventId }) => {
    const attendeeId = attendeeOf(actor);
    if (!attendeeId) return signInFirst();
    const event = await events.get(eventId);
    if (!event) return noEvent(eventId);
    const [entries, lastSync, abstractCorroborated] = await Promise.all([
      schedule.schedule(attendeeId, eventId),
      schedule.lastSync(attendeeId, eventId),
      schedule.hasCorroboratedAbstract(attendeeId, eventId),
    ]);
    return ok({
      eventId,
      timezone: event.timezone,
      entries: entries.map(({ entry, session }) => planEntryResource(entry, session, sessionUrlTemplate)),
      ...(lastSync && { lastSync }),
      readsAbstracts: canReadAbstract({ attendeeId, abstractCorroborated }),
    });
  };
}
