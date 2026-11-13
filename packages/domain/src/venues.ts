// Where a session is (issue #93): AWS's `venue` text to one of the venues
// Hallway can map, and the measured walk between two of them. The venues and
// their names are in venue-list.ts; what was measured is in venue-data.ts
// (docs/discovery/venues.md says how).
import { venueData } from "./venue-data";
import { venueList, type VenueId } from "./venue-list";

export type { VenueId };

/** A venue as the map draws it. Coordinates are [latitude, longitude]. */
export interface Venue {
  venueId: VenueId;
  name: string;
  osm: { type: "way" | "node" | "relation"; id: number };
  center: readonly [number, number];
  outline: readonly (readonly [number, number])[];
}

/** A walk from one venue's center to another's, as the router measured it. */
export interface Walk {
  from: VenueId;
  to: VenueId;
  meters: number;
  seconds: number;
  /** Whole minutes, rounded up: a walk of 12 min 10 s does not fit in 12. */
  minutes: number;
}

/** "Venetian | Level 2" -> "venetian"; "The MGM Grand, Room 118" -> "mgm grand". */
function fold(text: string): string {
  const first = text.split(/[|,]/)[0] ?? "";
  return first
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/^the /, "");
}

// Longest alias first, so "encore at wynn" wins over "encore" and "wynn".
const aliases = venueList
  .flatMap((venue) => venue.aliases.map((alias) => ({ alias, venueId: venue.venueId as VenueId })))
  .sort((a, b) => b.alias.length - a.alias.length);

/** The venue AWS's venue text names, or undefined when it names none Hallway maps. */
export function venueOf(text: string | undefined): VenueId | undefined {
  if (text === undefined) return undefined;
  const folded = fold(text);
  return aliases.find(({ alias }) => folded === alias || folded.startsWith(`${alias} `))?.venueId;
}

export const venues: readonly Venue[] = venueList.map((venue) => {
  const measured = venueData.venues.find((v) => v.venueId === venue.venueId);
  if (!measured) throw new Error(`${venue.venueId} has no measurements`);
  return { venueId: venue.venueId, name: venue.name, osm: venue.osm, center: measured.center, outline: measured.outline };
});

export const walks: readonly Walk[] = venueData.walks.map((walk) => ({
  from: walk.from,
  to: walk.to,
  meters: walk.meters,
  seconds: walk.seconds,
  minutes: Math.ceil(walk.seconds / 60),
}));

/** When the venues were measured, and when the walks were. */
export const venuesMeasuredOn = { venues: venueData.measuredOn, walks: venueData.walksMeasuredOn };
