import type { Attendee, PlanEntry } from "./types";

/** The signed-in attendee's id, or null for an anonymous viewer. */
export type ViewerId = string | null;

type Owner = Pick<Attendee, "id" | "visibility">;

/**
 * How the viewer stands to the owner, as far as the visibility rule cares
 * (ADR 0019). Only the owner's own acts are here: a connection they agreed to,
 * and a follow they made. Whether the viewer follows the owner is left out on
 * purpose: it never lets the viewer see anything.
 */
export interface Tie {
  /** A Hallway connection, which both sides agreed to. */
  connected: boolean;
  /** The owner follows the viewer: on GitHub, or found in the owner's own LinkedIn import. */
  followedByOwner: boolean;
}

/** How an anonymous viewer, the owner themselves, or a stranger stands. */
export const noTie: Tie = { connected: false, followedByOwner: false };

/**
 * The one visibility rule (domain.md "Rules"). Every read path (REST, MCP,
 * calendar feed, share image, link preview) asks this and nothing else.
 * `tie` is how the viewer stands to the owner; the caller looks it up, so
 * this stays pure.
 *
 * A `network` schedule is visible to the owner, their connections, and the
 * people they follow. Following someone never lets you see their schedule;
 * their following you does: the owner's act is the consent, nobody else's.
 */
export function canViewSchedule(viewer: ViewerId, owner: Owner, tie: Tie): boolean {
  if (viewer === owner.id) return true;
  switch (owner.visibility) {
    case "public":
      return true;
    case "network":
      return viewer !== null && (tie.connected || tie.followedByOwner);
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
  tie: Tie,
): PlanEntry[] {
  if (!canViewSchedule(viewer, owner, tie)) return [];
  if (viewer === owner.id) return [...entries];
  return entries.filter((entry) => !entry.hidden);
}

/**
 * The entries of `owner` that may leave Hallway in something `viewer` takes
 * away: the calendar feed, the share image, a link preview. The same as
 * `visibleEntries`, except that a hidden entry stays out even when the viewer
 * is the owner: the owner posts the image and subscribes others' eyes to it,
 * so it shows what everyone else would see.
 */
export function shareableEntries(
  viewer: ViewerId,
  owner: Owner,
  entries: readonly PlanEntry[],
  tie: Tie,
): PlanEntry[] {
  return visibleEntries(viewer, owner, entries, tie).filter((entry) => !entry.hidden);
}
