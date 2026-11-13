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
