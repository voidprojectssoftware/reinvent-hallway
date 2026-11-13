// GetEvent: the walking skeleton's one query. `GET /api/events/{eventId}` and
// the MCP tool `get_event` both call this, so neither holds logic the other
// lacks. Events are public facts about re:Invent, so every actor may read one.
import type { Event, GetEventInput } from "@hallway/contracts";
import type { Actor } from "../actor.ts";
import { fail, ok, type Outcome } from "../outcome.ts";
import type { EventRepository } from "./event-repository.ts";

export type GetEvent = (actor: Actor, input: GetEventInput) => Promise<Outcome<Event>>;

export function getEvent(events: EventRepository): GetEvent {
  return async (_actor, { eventId }) => {
    const event = await events.get(eventId);
    return event ? ok(event) : fail("not-found", `No event ${eventId}.`);
  };
}
