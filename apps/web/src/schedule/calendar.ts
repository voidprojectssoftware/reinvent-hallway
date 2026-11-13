// Where each session goes on the calendar view of a week (issue #91): which
// day, how far down and how tall (minutes after Las Vegas midnight), and
// which lane when sessions overlap. Pure, so the layout is tested without a
// browser; WeekCalendar.tsx draws what this returns.
import type { Session } from "@hallway/contracts";
import { eventDate, minuteOfDay } from "../time.ts";

/** One gridline's worth of minutes, and the "+N more" slot. */
export const slotMinutes = 30;
const dayMinutes = 24 * 60;
/** The grid shows at least 8:00 to 18:00, whatever the week holds. */
const earliest = 8 * 60;
const latest = 18 * 60;

export interface Span {
  /** The Las Vegas date it starts on. */
  date: string;
  /** Minutes after midnight. */
  start: number;
  /** Minutes after midnight, at most 24:00: a session running past midnight is drawn to the end of its day. */
  end: number;
  crossesMidnight: boolean;
  /** False when the session has a start but no end yet: drawn one slot tall, and its name gives the start only. */
  endKnown: boolean;
}

/** Where a session sits on the grid; null for an all-day session or one with no time yet. */
export function spanOf(session: Session): Span | null {
  if (!session.startsAt || session.isAllDay) return null;
  const start = minuteOfDay(session.startsAt);
  // The length from the instants, not the clock faces: right across midnight
  // and a change of offset alike.
  const length = session.endsAt ? (Date.parse(session.endsAt) - Date.parse(session.startsAt)) / 60_000 : slotMinutes;
  const end = start + Math.max(length, 1);
  return { date: eventDate(session.startsAt), start, end: Math.min(end, dayMinutes), crossesMidnight: end > dayMinutes, endKnown: !!session.endsAt };
}

/** The hours the grid shows: from the earliest start to the latest end across the week, on the hour, and at least 8:00 to 18:00. */
export function hoursShown(spans: readonly Span[]): { start: number; end: number } {
  const start = Math.min(earliest, ...spans.map((span) => Math.floor(span.start / 60) * 60));
  const end = Math.max(latest, ...spans.map((span) => Math.ceil(span.end / 60) * 60));
  return { start, end };
}

export interface Placed<T> {
  item: T;
  /** Its lane, from 0, and how many lanes share the width where it sits. */
  lane: number;
  lanes: number;
}

export interface More {
  /** The slot's start, minutes after midnight. */
  start: number;
  count: number;
  /** The lane the "+N more" sits in, of `lanes`. */
  lane: number;
  lanes: number;
}

/**
 * Lays out one day. Sessions that overlap, directly or through a chain, form
 * a cluster and share its width side by side, each in the first lane free
 * when it starts. A cluster needing more lanes than `maxLanes` (the day's
 * width over the narrowest tappable block) keeps `maxLanes - 1` of them and
 * gives the last to "+N more", one per slot, counting the sessions that
 * start in that slot and did not fit.
 */
export function layoutDay<T extends { span: Span }>(items: readonly T[], maxLanes: number): { placed: Placed<T>[]; more: More[] } {
  const room = Math.max(2, maxLanes);
  const sorted = [...items].sort((a, b) => a.span.start - b.span.start || b.span.end - a.span.end);
  const placed: Placed<T>[] = [];
  const more: More[] = [];

  let cluster: { item: T; lane: number }[] = [];
  let laneEnds: number[] = [];
  let clusterEnd = -1;
  const flush = () => {
    const needed = laneEnds.length;
    const crowded = needed > room;
    const shown = crowded ? room - 1 : needed;
    const lanes = crowded ? room : needed;
    const hidden = new Map<number, number>();
    for (const { item, lane } of cluster) {
      if (lane < shown) placed.push({ item, lane, lanes });
      else {
        const slot = Math.floor(item.span.start / slotMinutes) * slotMinutes;
        hidden.set(slot, (hidden.get(slot) ?? 0) + 1);
      }
    }
    for (const [start, count] of hidden) more.push({ start, count, lane: room - 1, lanes: room });
    cluster = [];
    laneEnds = [];
  };

  for (const item of sorted) {
    if (cluster.length > 0 && item.span.start >= clusterEnd) flush();
    let lane = laneEnds.findIndex((end) => end <= item.span.start);
    if (lane === -1) lane = laneEnds.push(item.span.end) - 1;
    else laneEnds[lane] = item.span.end;
    cluster.push({ item, lane });
    clusterEnd = Math.max(cluster.length === 1 ? item.span.end : clusterEnd, item.span.end);
  }
  if (cluster.length > 0) flush();
  more.sort((a, b) => a.start - b.start);
  return { placed, more };
}

/** The slot a "+N more" opens in the list: is this session on during it? */
export function inSlot(session: Session, date: string, slotStart: number): boolean {
  const span = spanOf(session);
  return !!span && span.date === date && span.start < slotStart + slotMinutes && span.end > slotStart;
}

/** "09:30" for the list's ?at=, and back; null for anything that is not a slot on the grid. */
export const slotParam = (minute: number) => `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
export function parseSlot(text: string | null): number | null {
  const match = text?.match(/^(\d{2}):(\d{2})$/);
  if (!match) return null;
  const minute = Number(match[1]) * 60 + Number(match[2]);
  return minute < dayMinutes && minute % slotMinutes === 0 ? minute : null;
}
