// Where a reader stands with session descriptions (ADR 0025, issue #88),
// from my schedule: none when signed out, no last sync when my agent never
// synced, and the API's word on whether another attendee has corroborated
// a description I synced.
import type { MySchedule } from "@hallway/contracts";
import type { DescriptionReader } from "./copy.ts";

export function descriptionReader(schedule: Pick<MySchedule, "lastSync" | "readsAbstracts"> | null): DescriptionReader {
  if (!schedule) return "signed-out";
  if (schedule.readsAbstracts) return "confirmed";
  return schedule.lastSync ? "unconfirmed" : "never-synced";
}
