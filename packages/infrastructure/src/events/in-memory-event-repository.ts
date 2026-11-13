import type { EventRepository } from "@hallway/application";
import type { Event } from "@hallway/contracts";

/** The fake: what tests of apps/api run on when they do not need a database. */
export function eventsInMemory(seed: readonly Event[]): EventRepository {
  const byId = new Map(seed.map((event) => [event.eventId, structuredClone(event)]));
  return {
    async get(eventId) {
      const event = byId.get(eventId);
      return event && structuredClone(event);
    },
  };
}
