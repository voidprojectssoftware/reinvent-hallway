import { localToEpoch, parseLocalTime, toLocal } from "./time";
import type { Session } from "./types";

/** What a busy block needs: the session's place in time. */
export type Placed = Pick<Session, "startsAt" | "endsAt" | "isAllDay">;

export interface Gap {
  startsAt: string;
  endsAt: string;
  /** Event-local "HH:MM", for display and for agents. */
  start: string;
  end: string;
}

/**
 * Windows on `day` between `dayStart` and `dayEnd` (event-local "HH:MM")
 * when neither list has a session, at least `minMinutes` long. Pass each
 * side's entries as the asker may see them: mine all, theirs visible and not
 * hidden (`visibleEntries`).
 *
 * All-day sessions do not block: they are drop-in (expo, lounges), and
 * counting them would leave no gap on any day either of us favorited one.
 * A session with no start or no end cannot be placed and does not block.
 * Sessions are clipped to the window, so one that crosses midnight blocks
 * only its own part of `day`.
 */
export function findGaps(
  entriesA: readonly Placed[],
  entriesB: readonly Placed[],
  day: string,
  dayStart: string,
  dayEnd: string,
  minMinutes: number,
  timezone: string,
): Gap[] {
  const from = parseLocalTime(dayStart);
  const to = parseLocalTime(dayEnd);
  if (from === undefined || to === undefined || from >= to) return [];
  const windowStart = localToEpoch(day, from, timezone);
  const windowEnd = localToEpoch(day, to, timezone);
  if (windowStart === undefined || windowEnd === undefined) return [];

  const busy: [number, number][] = [];
  for (const entry of [...entriesA, ...entriesB]) {
    if (entry.isAllDay || !entry.startsAt || !entry.endsAt) continue;
    const start = Math.max(Date.parse(entry.startsAt), windowStart);
    const end = Math.min(Date.parse(entry.endsAt), windowEnd);
    if (start < end) busy.push([start, end]);
  }
  busy.sort((x, y) => x[0] - y[0]);

  const gaps: Gap[] = [];
  const minMs = minMinutes * 60_000;
  const emit = (start: number, end: number) => {
    if (end - start < minMs || end <= start) return;
    gaps.push({
      startsAt: new Date(start).toISOString(),
      endsAt: new Date(end).toISOString(),
      start: toLocal(start, timezone).time,
      end: toLocal(end, timezone).time,
    });
  };

  let cursor = windowStart;
  for (const [start, end] of busy) {
    if (start > cursor) emit(cursor, start);
    cursor = Math.max(cursor, end);
  }
  emit(cursor, windowEnd);
  return gaps;
}
