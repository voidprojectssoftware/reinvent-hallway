// ExportCalendar as iCalendar (RFC 5545), for `GET /cal/{token}.ics`. Calendar
// apps poll this URL, so what matters most is that an event keeps its UID
// across polls (a moved session updates in place instead of appearing twice)
// and that times are Las Vegas wall time with the zone spelled out, as the
// badge says (domain.md "Times").
import type { SharedSchedule } from "@hallway/application";

/**
 * VTIMEZONE blocks by IANA name. Only re:Invent's zone is needed; its rules
 * (US daylight time since 2007) cover any date a session can have. An event in
 * a zone not listed here gets UTC times, which every client places correctly.
 */
const vtimezones: Record<string, string[]> = {
  "America/Los_Angeles": [
    "BEGIN:VTIMEZONE",
    "TZID:America/Los_Angeles",
    "X-LIC-LOCATION:America/Los_Angeles",
    "BEGIN:DAYLIGHT",
    "TZOFFSETFROM:-0800",
    "TZOFFSETTO:-0700",
    "TZNAME:PDT",
    "DTSTART:19700308T020000",
    "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU",
    "END:DAYLIGHT",
    "BEGIN:STANDARD",
    "TZOFFSETFROM:-0700",
    "TZOFFSETTO:-0800",
    "TZNAME:PST",
    "DTSTART:19701101T020000",
    "RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU",
    "END:STANDARD",
    "END:VTIMEZONE",
  ],
};

/** TEXT values escape backslash, semicolon, comma and newline (RFC 5545 3.3.11). */
export function escapeText(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

const encoder = new TextEncoder();

/**
 * Folds a content line so no physical line is over 75 octets (RFC 5545 3.1),
 * never splitting a UTF-8 character: continuation lines start with a space,
 * which counts toward their 75.
 */
export function foldLine(line: string): string {
  const out: string[] = [];
  let current = "";
  let octets = 0;
  for (const char of line) {
    const size = encoder.encode(char).length;
    const limit = out.length === 0 ? 75 : 74;
    if (octets + size > limit) {
      out.push(current);
      current = "";
      octets = 0;
    }
    current += char;
    octets += size;
  }
  out.push(current);
  return out.join("\r\n ");
}

/** "2026-12-01T18:00:00.000Z" as "20261201T180000Z". */
const utcStamp = (instant: string) => new Date(instant).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

function wallClock(instant: string, timezone: string): string {
  const parts: Record<string, string> = {};
  const format = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  for (const part of format.formatToParts(new Date(instant))) parts[part.type] = part.value;
  return `${parts.year}${parts.month}${parts.day}T${parts.hour}${parts.minute}${parts.second}`;
}

/** The property for a time: zoned wall time when we have the zone's VTIMEZONE, else UTC. */
function timeProperty(name: "DTSTART" | "DTEND", instant: string, timezone: string): string {
  return vtimezones[timezone]
    ? `${name};TZID=${timezone}:${wallClock(instant, timezone)}`
    : `${name}:${utcStamp(instant)}`;
}

/** An all-day session's local date, and the day after (DTEND is exclusive). */
function allDay(instant: string, timezone: string): [string, string] {
  const date = wallClock(instant, timezone).slice(0, 8);
  const next = new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(4, 6)) - 1, Number(date.slice(6, 8)) + 1));
  return [date, next.toISOString().slice(0, 10).replace(/-/g, "")];
}

export function toICalendar(shared: SharedSchedule, now: Date): string {
  const { attendee, event } = shared;
  const tz = event.timezone;
  const stamp = utcStamp(now.toISOString());
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Hallway//re:Invent schedule//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeText(`${attendee.displayName} at ${event.name}`)}`,
    `X-WR-TIMEZONE:${tz}`,
    // How often a subscribed calendar should poll; clients that honor it
    // pick up a sync within the hour.
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
    "X-PUBLISHED-TTL:PT1H",
    ...(vtimezones[tz] ?? []),
  ];

  for (const { intent, session } of shared.entries) {
    // A session with no time cannot be placed on a calendar.
    if (!session.startsAt) continue;
    const title = session.title ?? session.code ?? "re:Invent session";
    const where = [session.venue, session.room].filter(Boolean).join(", ");
    const description = [
      intent === "reserved" ? "Reserved on re:Invent." : "Interested (an AWS favorite, no seat reserved).",
      session.code ? `Session ${session.code}.` : undefined,
      session.speakers?.length ? `Speakers: ${session.speakers.join(", ")}.` : undefined,
      session.url,
    ].filter((line): line is string => line !== undefined);

    lines.push(
      "BEGIN:VEVENT",
      // The owner and the session: stable across polls and syncs, so a
      // changed session replaces its event rather than adding one.
      `UID:${session.sessionId}.${attendee.id}@hallway`,
      `DTSTAMP:${stamp}`,
    );
    if (session.isAllDay) {
      const [first, after] = allDay(session.startsAt, tz);
      lines.push(`DTSTART;VALUE=DATE:${first}`, `DTEND;VALUE=DATE:${after}`, "TRANSP:TRANSPARENT");
    } else {
      lines.push(timeProperty("DTSTART", session.startsAt, tz));
      if (session.endsAt) lines.push(timeProperty("DTEND", session.endsAt, tz));
    }
    lines.push(
      `SUMMARY:${escapeText(session.code ? `${title} (${session.code})` : title)}`,
      ...(where ? [`LOCATION:${escapeText(where)}`] : []),
      `DESCRIPTION:${escapeText(description.join("\n"))}`,
      ...(session.url ? [`URL:${session.url}`] : []),
      `STATUS:${intent === "reserved" ? "CONFIRMED" : "TENTATIVE"}`,
      "END:VEVENT",
    );
  }

  lines.push("END:VCALENDAR");
  return lines.map(foldLine).join("\r\n") + "\r\n";
}
