// One day of a week as a path across the campus (issue #93): the day's timed
// sessions in time order, numbered, and between each two the walk from one
// venue to the next against the time the schedule leaves for it. Worked out
// here from the entries the screen holds and the Venues resource, as clash.ts
// works out overlaps: the walking times are measured facts from the server;
// putting them next to my own times is this screen's job.
//
// A walk that takes longer than the gap is "tight". Walks are center to
// center and leave out the walk inside a venue to the room, so a gap equal
// to the walk is not tight, and the warning is a floor, not a promise.
import type { Session, Venues, Walk } from "@hallway/contracts";
import { eventDate } from "../time.ts";

export interface PathEntry {
  sessionId: string;
  session: Session;
}

export interface Stop<E extends PathEntry> {
  entry: E;
  /** 1 for the day's first timed session, and so on. */
  number: number;
}

export type LegWalk =
  | { kind: "walk"; minutes: number; meters: number }
  | { kind: "same-venue" }
  /** One of the two venues is not on the map. */
  | { kind: "unknown" };

export interface Leg<E extends PathEntry> {
  from: Stop<E>;
  to: Stop<E>;
  walk: LegWalk;
  /** Minutes from the end of `from` to the start of `to`; negative when they overlap. */
  gap: number;
  tight: boolean;
}

export interface Pin<E extends PathEntry> {
  venueId: string;
  /** The day's sessions there: timed ones in order, then all-day ones. */
  entries: E[];
  /** The path numbers of the timed ones. */
  numbers: number[];
}

export interface DayPath<E extends PathEntry> {
  stops: Stop<E>[];
  legs: Leg<E>[];
  allDay: E[];
  pins: Pin<E>[];
  /** Sessions on this day whose venue Hallway cannot place. */
  unplaced: E[];
}

const minute = 60_000;

/** The day's sessions laid out as a path. Untimed sessions are not on any day, so not here. */
export function dayPath<E extends PathEntry>(entries: readonly E[], date: string, venues: Pick<Venues, "venues" | "walks">): DayPath<E> {
  const known = new Set(venues.venues.map((venue) => venue.venueId));
  const placed = (entry: E) => entry.session.venueId !== undefined && known.has(entry.session.venueId);
  const onDay = entries.filter((entry) => entry.session.startsAt && eventDate(entry.session.startsAt) === date);
  const allDay = onDay.filter((entry) => entry.session.isAllDay);
  const stops = onDay
    .filter((entry) => !entry.session.isAllDay)
    .sort((a, b) => Date.parse(a.session.startsAt!) - Date.parse(b.session.startsAt!))
    .map((entry, index) => ({ entry, number: index + 1 }));

  const legs = stops.slice(1).map((to, index): Leg<E> => {
    const from = stops[index]!;
    const end = from.entry.session.endsAt ?? from.entry.session.startsAt!;
    const gap = Math.round((Date.parse(to.entry.session.startsAt!) - Date.parse(end)) / minute);
    const walk = walkBetween(from.entry, to.entry, placed, venues.walks);
    return { from, to, walk, gap, tight: gap < 0 || (walk.kind === "walk" && walk.minutes > gap) };
  });

  const pins = new Map<string, Pin<E>>();
  const pinFor = (venueId: string) => {
    let pin = pins.get(venueId);
    if (!pin) pins.set(venueId, (pin = { venueId, entries: [], numbers: [] }));
    return pin;
  };
  for (const stop of stops) {
    if (!placed(stop.entry)) continue;
    const pin = pinFor(stop.entry.session.venueId!);
    pin.entries.push(stop.entry);
    pin.numbers.push(stop.number);
  }
  for (const entry of allDay) if (placed(entry)) pinFor(entry.session.venueId!).entries.push(entry);

  return { stops, legs, allDay, pins: [...pins.values()], unplaced: onDay.filter((entry) => !placed(entry)) };
}

function walkBetween<E extends PathEntry>(from: E, to: E, placed: (entry: E) => boolean, walks: readonly Walk[]): LegWalk {
  if (!placed(from) || !placed(to)) return { kind: "unknown" };
  if (from.session.venueId === to.session.venueId) return { kind: "same-venue" };
  const walk = walks.find((w) => w.from === from.session.venueId && w.to === to.session.venueId);
  return walk ? { kind: "walk", minutes: walk.minutes, meters: walk.meters } : { kind: "unknown" };
}

/** "45 min", "1 h", "1 h 30 min", with no-break spaces so "4 h" never splits over two lines. */
export function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const text = h === 0 ? `${m} min` : m === 0 ? `${h} h` : `${h} h ${m} min`;
  return text.replaceAll(" ", "\u00a0");
}

/** "12 min walk (0.9 km), 10 min between sessions", as the issue words it. */
export function legLabel(leg: Leg<PathEntry>): string {
  if (leg.gap < 0) return "Starts before the one before it ends";
  const between = leg.gap === 0 ? "no time between sessions" : `${formatMinutes(leg.gap)} between sessions`;
  switch (leg.walk.kind) {
    case "same-venue":
      return `Same venue, ${between}`;
    case "unknown":
      return `No walking time (a venue not on the map), ${between}`;
    case "walk":
      return `${formatMinutes(leg.walk.minutes)} walk (${(leg.walk.meters / 1000).toFixed(1)} km), ${between}`;
  }
}
