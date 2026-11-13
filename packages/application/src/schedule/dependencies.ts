import type { EventRepository } from "../events/event-repository.ts";
import type { ScheduleRepository } from "./schedule-repository.ts";

/** What the schedule handlers are built over; apps/api's composition root supplies it. */
export interface ScheduleDependencies {
  events: EventRepository;
  schedule: ScheduleRepository;
  /** SESSION_URL_TEMPLATE: a session's link is this with `{code}` filled in. */
  sessionUrlTemplate: string;
  now: () => Date;
}
