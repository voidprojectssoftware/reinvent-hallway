import type { GoingPerson } from "@hallway/contracts";
import type { Actor } from "../actor.ts";
import type { EventRepository } from "../events/event-repository.ts";
import type { ScheduleRepository } from "./schedule-repository.ts";

/**
 * Per session id, the asker's connections going whose entry the asker may
 * see, by display name, each with their intent; undefined for an anonymous
 * asker, who has none. The network slice answers it (`connectionsGoing`);
 * sessions carry its count.
 */
export type ConnectionsGoingLookup = (
  actor: Actor,
  eventId: string,
  sessionIds: readonly string[],
) => Promise<Map<string, GoingPerson[]> | undefined>;

/** What the schedule handlers are built over; apps/api's composition root supplies it. */
export interface ScheduleDependencies {
  events: EventRepository;
  schedule: ScheduleRepository;
  /** SESSION_URL_TEMPLATE: a session's link is this with `{code}` filled in. */
  sessionUrlTemplate: string;
  /**
   * SHOW_SESSION_DESCRIPTIONS: whether session search and get carry a
   * session's abstract. The one off switch for descriptions (issue #103):
   * those two are the only reads of it, so off hides it from REST, MCP and
   * the web at once.
   */
  showSessionDescriptions: boolean;
  now: () => Date;
  connectionsGoing: ConnectionsGoingLookup;
}
