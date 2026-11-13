import type { Person } from "@hallway/contracts";
import type { Actor } from "../actor.ts";
import type { EventRepository } from "../events/event-repository.ts";
import type { ScheduleRepository } from "./schedule-repository.ts";

/**
 * Per session id, the asker's connections going whose entry the asker may
 * see, by display name; undefined for an anonymous asker, who has none. The
 * network slice answers it (`connectionsGoing`); sessions carry its count.
 */
export type ConnectionsGoingLookup = (
  actor: Actor,
  eventId: string,
  sessionIds: readonly string[],
) => Promise<Map<string, Person[]> | undefined>;

/** What the schedule handlers are built over; apps/api's composition root supplies it. */
export interface ScheduleDependencies {
  events: EventRepository;
  schedule: ScheduleRepository;
  /** SESSION_URL_TEMPLATE: a session's link is this with `{code}` filled in. */
  sessionUrlTemplate: string;
  now: () => Date;
  connectionsGoing: ConnectionsGoingLookup;
}
