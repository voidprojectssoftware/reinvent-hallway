// GetEvent: the walking skeleton's one query. `GET /api/events/{eventId}` and
// the MCP tool `get_event` both call this, so neither holds logic the other
// lacks. Events are public facts about re:Invent, so every actor may read one.
import type { Event, GetEventInput } from "@hallway/contracts";
import type { Actor } from "../actor.ts";
import { fail, ok, type Outcome } from "../outcome.ts";
import type { EventRepository } from "./event-repository.ts";

export type GetEvent = (actor: Actor, input: GetEventInput) => Promise<Outcome<Event>>;

/** The refusal for an event id Hallway does not know, naming the one it does. */
export const noEvent = <T = never>(eventId: string): Outcome<T> =>
  fail("not-found", `No event ${eventId}. Hallway knows re:Invent 2026, \`reinvent2026\`.`);

export function getEvent(events: EventRepository): GetEvent {
  return async (_actor, { eventId }) => {
    const event = await events.get(eventId);
    return event ? ok(event) : noEvent(eventId);
  };
}
