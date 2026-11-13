import type { Attendee, PlanEntry } from "./types";

/** The signed-in attendee's id, or null for an anonymous viewer. */
export type ViewerId = string | null;

type Owner = Pick<Attendee, "id" | "visibility">;

/**
 * The one visibility rule (domain.md "Rules"). Every read path (REST, MCP,
 * calendar feed, share image, link preview) asks this and nothing else.
 * `areConnected` is whether viewer and owner are connected; the caller looks
 * it up, so this stays pure.
 */
export function canViewSchedule(
  viewer: ViewerId,
  owner: Owner,
  areConnected: boolean,
): boolean {
  if (viewer === owner.id) return true;
  switch (owner.visibility) {
    case "public":
      return true;
    case "connections":
      return viewer !== null && areConnected;
    case "private":
      return false;
  }
}

/**
 * The entries of `owner` that `viewer` may see: none if the schedule is not
 * visible to them, all of them for the owner, and otherwise all but the
 * hidden ones. "Who is going" counts must come from this too, so a hidden
 * entry is never counted.
 */
export function visibleEntries(
  viewer: ViewerId,
  owner: Owner,
  entries: readonly PlanEntry[],
  areConnected: boolean,
): PlanEntry[] {
  if (!canViewSchedule(viewer, owner, areConnected)) return [];
  if (viewer === owner.id) return [...entries];
  return entries.filter((entry) => !entry.hidden);
}
