// Every time on screen is Las Vegas time, whatever zone the viewer is in,
// because that is the time on the badge (domain.md, "Times"). This module is
// the only place the app turns an instant into words; nothing else calls
// toLocaleString or Intl.DateTimeFormat.
export const EVENT_TIME_ZONE = "America/Los_Angeles";

const clock = new Intl.DateTimeFormat("en-US", { timeZone: EVENT_TIME_ZONE, hour: "numeric", minute: "2-digit" });
const day = new Intl.DateTimeFormat("en-US", { timeZone: EVENT_TIME_ZONE, weekday: "long", day: "numeric", month: "long" });
const zone = new Intl.DateTimeFormat("en-US", { timeZone: EVENT_TIME_ZONE, timeZoneName: "short" });

type Instant = string | Date;
const at = (instant: Instant) => (typeof instant === "string" ? new Date(instant) : instant);
const part = (format: Intl.DateTimeFormat, instant: Instant, type: Intl.DateTimeFormatPartTypes) =>
  format.formatToParts(at(instant)).find((p) => p.type === type)?.value ?? "";

/** "8:00 AM" */
export function formatTime(instant: Instant): string {
  return clock.format(at(instant));
}

/** "Tuesday 1 December", the design's order (day before month). */
export function formatDay(instant: Instant): string {
  return `${part(day, instant, "weekday")} ${part(day, instant, "day")} ${part(day, instant, "month")}`;
}

/** "PST", for the one line per screen that says what the times are in. */
export function zoneAbbreviation(instant: Instant): string {
  return part(zone, instant, "timeZoneName");
}

const isoDay = new Intl.DateTimeFormat("en-CA", { timeZone: EVENT_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" });

/** "2026-12-01": the Las Vegas date an instant falls on, to group a week by day. */
export function eventDate(instant: Instant): string {
  return isoDay.format(at(instant));
}

const hourMinute = new Intl.DateTimeFormat("en-US", { timeZone: EVENT_TIME_ZONE, hour: "numeric", minute: "numeric", hourCycle: "h23" });

/** Minutes after Las Vegas midnight: 510 for 8:30 AM. Places a session on the calendar's grid. */
export function minuteOfDay(instant: Instant): number {
  return Number(part(hourMinute, instant, "hour")) * 60 + Number(part(hourMinute, instant, "minute"));
}

/** "8 AM", "9:30 AM": a time on the calendar's grid, from minutes after midnight (no instant, so no zone). */
export function formatMinute(minute: number): string {
  const hour = Math.floor(minute / 60) % 24;
  const past = minute % 60;
  return `${hour % 12 || 12}${past ? `:${String(past).padStart(2, "0")}` : ""} ${hour < 12 ? "AM" : "PM"}`;
}

const meridiem = /\s*([AP]M)$/;

/** "8:30 to 9:30 AM", "11:30 AM to 12:30 PM": the meridiem said once when both ends share it. */
export function formatTimeRange(start: Instant, end: Instant): string {
  const from = formatTime(start);
  const to = formatTime(end);
  return from.match(meridiem)?.[1] === to.match(meridiem)?.[1] ? `${from.replace(meridiem, "")} to ${to}` : `${from} to ${to}`;
}

// A date alone ("2026-12-01") names a day, not an instant, so it is read and
// written at noon UTC in UTC, where no zone moves it to another day.
const dateOnly = (date: string) => new Date(`${date}T12:00:00Z`);
const chip = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short", day: "numeric" });

/** The day picker's two lines for a date: { weekday: "Tue", day: "1" }. */
export function dayChip(date: string): { weekday: string; day: string } {
  const parts = chip.formatToParts(dateOnly(date));
  const of = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  return { weekday: of("weekday"), day: of("day") };
}

/** "Tuesday 1 December" for a date alone. Noon in Las Vegas is on that date. */
export function formatDate(date: string): string {
  return formatDay(`${date}T20:00:00Z`);
}

/**
 * Every date of the event, first to last. The event's dates carry its own
 * offset (`2026-11-30T05:30-08:00`), so their date part is already local.
 */
export function eventDates(startDate: string, endDate: string): string[] {
  const dates: string[] = [];
  const last = endDate.slice(0, 10);
  for (let d = dateOnly(startDate.slice(0, 10)); d.toISOString().slice(0, 10) <= last; d.setUTCDate(d.getUTCDate() + 1)) {
    dates.push(d.toISOString().slice(0, 10));
  }
  return dates;
}

const relative = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
const steps: [Intl.RelativeTimeFormatUnit, number][] = [
  ["day", 86_400_000],
  ["hour", 3_600_000],
  ["minute", 60_000],
];

/** "12 minutes ago", for when a token was last used. */
export function formatAgo(instant: Instant, now: Date = new Date()): string {
  const elapsed = now.getTime() - at(instant).getTime();
  for (const [unit, size] of steps) {
    if (elapsed >= size) return relative.format(-Math.floor(elapsed / size), unit);
  }
  return "just now";
}
