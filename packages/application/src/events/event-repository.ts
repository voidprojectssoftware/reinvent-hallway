import type { Event } from "@hallway/contracts";

/** Where events are kept. packages/infrastructure implements it on D1 and in memory. */
export interface EventRepository {
  /** The event, or undefined when there is none with that id. */
  get(eventId: string): Promise<Event | undefined>;
}
