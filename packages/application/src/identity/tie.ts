import { noTie, type Tie, type ViewerId } from "@hallway/domain";
import type { TieBetween } from "./ports.ts";

/**
 * What the visibility rule is handed for one viewer and one owner: nothing to
 * look up for an anonymous viewer or the owner themselves, otherwise the one
 * lookup every read path shares.
 */
export async function viewerTie(tieBetween: TieBetween, viewer: ViewerId, ownerId: string): Promise<Tie> {
  return viewer === null || viewer === ownerId ? noTie : tieBetween(viewer, ownerId);
}
