// Event-local wall time <-> UTC instants, through Intl and the IANA zone name.
// Never through a fixed offset or an abbreviation: AWS labels re:Invent 2026
// "PDT", but the week of 30 November is PST (UTC-8).

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timezone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timezone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(timezone, formatter);
  }
  return formatter;
}

interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function wallClockAt(epochMs: number, timezone: string): WallClock {
  const parts: Record<string, number> = {};
  for (const part of formatterFor(timezone).formatToParts(new Date(epochMs))) {
    if (part.type !== "literal") parts[part.type] = Number(part.value);
  }
  return {
    year: parts.year!,
    month: parts.month!,
    day: parts.day!,
    hour: parts.hour!,
    minute: parts.minute!,
    second: parts.second!,
  };
}

/** How far the zone's wall clock is ahead of UTC at that instant, in ms. */
function offsetAt(epochMs: number, timezone: string): number {
  const whole = Math.floor(epochMs / 1000) * 1000;
  const w = wallClockAt(whole, timezone);
  return Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second) - whole;
}

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/;

/** "2026-12-01" as [year, month, day], or undefined if it is not a real date. */
export function parseLocalDate(date: string): [number, number, number] | undefined {
  const match = DATE.exec(date.trim());
  if (!match) return undefined;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return undefined;
  return [year, month, day];
}

/** "16:00" (or "16:00:00") as minutes after midnight, or undefined. */
export function parseLocalTime(time: string): number | undefined {
  const match = TIME.exec(time.trim());
  if (!match) return undefined;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return undefined;
  return hour * 60 + minute;
}

/**
 * The UTC instant at which the wall clock in `timezone` reads `date` at
 * `minutes` past midnight (minutes may run past 1440 into the next day), as
 * epoch milliseconds. Undefined if the date is not real.
 */
export function localToEpoch(date: string, minutes: number, timezone: string): number | undefined {
  const ymd = parseLocalDate(date);
  if (!ymd) return undefined;
  const wall = Date.UTC(ymd[0], ymd[1] - 1, ymd[2], 0, minutes);
  // The offset at the wall time read as UTC is right except within a few
  // hours of a DST change; one correction settles it.
  const first = wall - offsetAt(wall, timezone);
  const second = wall - offsetAt(first, timezone);
  return second;
}

/** The event-local date ("2026-12-01") and time ("16:00") of a UTC instant. */
export function toLocal(instant: string | number, timezone: string): { date: string; time: string } {
  const w = wallClockAt(typeof instant === "number" ? instant : Date.parse(instant), timezone);
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    date: `${w.year}-${pad(w.month)}-${pad(w.day)}`,
    time: `${pad(w.hour)}:${pad(w.minute)}`,
  };
}

/**
 * The UTC instants a local day in `timezone` runs between: `from` is local
 * midnight, `to` the next local midnight (exclusive), as ISO strings like the
 * ones `toSession` writes, so they compare as text. Undefined if the date is
 * not real. A session is "on" a day when its start falls in it.
 */
export function dayBounds(date: string, timezone: string): { from: string; to: string } | undefined {
  const from = localToEpoch(date, 0, timezone);
  const to = localToEpoch(date, 24 * 60, timezone);
  if (from === undefined || to === undefined) return undefined;
  return { from: new Date(from).toISOString(), to: new Date(to).toISOString() };
}

/**
 * The UTC instants between event-local `from` and `to` ("HH:MM", "24:00" for
 * the end of the day) on `date`, as ISO strings, or undefined if the date or
 * a time is not real or the window is empty.
 */
export function localWindow(
  date: string,
  from: string,
  to: string,
  timezone: string,
): { from: string; to: string } | undefined {
  const minutes = (time: string) => (time.trim() === "24:00" ? 24 * 60 : parseLocalTime(time));
  const [start, end] = [minutes(from), minutes(to)];
  if (start === undefined || end === undefined || start >= end) return undefined;
  const startMs = localToEpoch(date, start, timezone);
  const endMs = localToEpoch(date, end, timezone);
  if (startMs === undefined || endMs === undefined) return undefined;
  return { from: new Date(startMs).toISOString(), to: new Date(endMs).toISOString() };
}
