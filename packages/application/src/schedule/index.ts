import type { ScheduleDependencies } from "./dependencies.ts";
import { getMySchedule, type GetMySchedule } from "./get-my-schedule.ts";
import {
  addToPlan,
  removeFromPlan,
  setEntryHidden,
  type AddToPlan,
  type RemoveFromPlan,
  type SetEntryHidden,
} from "./plan-entries.ts";
import { getSession, searchSessions, type GetSession, type SearchSessions } from "./sessions.ts";
import { syncSchedule, type SyncSchedule } from "./sync-schedule.ts";

export type { ConnectionsGoingLookup, ScheduleDependencies } from "./dependencies.ts";
export type {
  CatalogSession,
  ScheduledEntry,
  ScheduleRepository,
  SessionFilter,
  SyncWrite,
} from "./schedule-repository.ts";
export type { AddToPlan, GetMySchedule, GetSession, RemoveFromPlan, SearchSessions, SetEntryHidden, SyncSchedule };

/** The schedule slice's handlers, as apps/api's `Handlers` carries them. */
export interface ScheduleHandlers {
  syncSchedule: SyncSchedule;
  getMySchedule: GetMySchedule;
  addToPlan: AddToPlan;
  removeFromPlan: RemoveFromPlan;
  setEntryHidden: SetEntryHidden;
  searchSessions: SearchSessions;
  getSession: GetSession;
}

export function scheduleHandlers(dependencies: ScheduleDependencies): ScheduleHandlers {
  return {
    syncSchedule: syncSchedule(dependencies),
    getMySchedule: getMySchedule(dependencies),
    addToPlan: addToPlan(dependencies),
    removeFromPlan: removeFromPlan(dependencies),
    setEntryHidden: setEntryHidden(dependencies),
    searchSessions: searchSessions(dependencies),
    getSession: getSession(dependencies),
  };
}
