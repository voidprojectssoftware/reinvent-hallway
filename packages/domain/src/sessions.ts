import { localToEpoch, parseLocalTime } from "./time";
import type { Event, Session } from "./types";

/**
 * The parts of the AWS Events API `Session` (openapi-2026-11-13.json) that
 * Hallway reads. Everything else it sends, the abstract and the taxonomies
 * other than topics, is not read, so it cannot reach storage (ADR 0003).
 */
export interface AwsSession {
  sessionId: string;
  title?: string;
  abbreviation?: string;
  type?: string;
  level?: string;
  venue?: string;
  room?: string;
  isAllDaySession?: boolean;
  sessionTime?: {
    date?: string;
    time?: string;
    /** Minutes, as a string: "60". */
    length?: string;
    timezone?: string;
  };
  speakers?: { name?: string }[];
  topics?: string[];
}

const MINUTES_PER_DAY = 24 * 60;

function placeInTime(
  aws: AwsSession,
  timezone: string,
): Pick<Session, "startsAt" | "endsAt"> {
  const date = aws.sessionTime?.date;
  if (date === undefined) return {};
  const iso = (ms: number | undefined) => (ms === undefined ? undefined : new Date(ms).toISOString());

  if (aws.isAllDaySession) {
    const startsAt = iso(localToEpoch(date, 0, timezone));
    const endsAt = iso(localToEpoch(date, MINUTES_PER_DAY, timezone));
    return startsAt && endsAt ? { startsAt, endsAt } : {};
  }

  const start = aws.sessionTime?.time === undefined ? undefined : parseLocalTime(aws.sessionTime.time);
  if (start === undefined) return {};
  const startsAt = iso(localToEpoch(date, start, timezone));
  if (!startsAt) return {};

  const lengthText = aws.sessionTime?.length?.trim();
  const length = lengthText && /^\d+$/.test(lengthText) ? Number(lengthText) : undefined;
  if (length === undefined) return { startsAt };
  return { startsAt, endsAt: iso(localToEpoch(date, start + length, timezone))! };
}

/**
 * A Hallway session snapshot from AWS's session. AWS gives a local date, time
 * and length in the event's zone; we keep UTC instants. The event's zone is
 * used even when `sessionTime.timezone` is present, because domain.md fixes
 * session times to the event's zone and AWS documents that field as optional
 * and free-form. A field AWS left out stays absent, so `mergeSnapshot` keeps
 * the old value.
 */
export function toSession(aws: AwsSession, event: Pick<Event, "eventId" | "timezone">): Session {
  const session: Session = { sessionId: aws.sessionId, eventId: event.eventId };
  if (aws.abbreviation !== undefined) session.code = aws.abbreviation;
  if (aws.title !== undefined) session.title = aws.title;
  if (aws.type !== undefined) session.type = aws.type;
  if (aws.level !== undefined) session.level = aws.level;
  if (aws.venue !== undefined) session.venue = aws.venue;
  if (aws.room !== undefined) session.room = aws.room;
  if (aws.isAllDaySession !== undefined) session.isAllDay = aws.isAllDaySession;
  Object.assign(session, placeInTime(aws, event.timezone));
  if (aws.speakers !== undefined) {
    session.speakers = aws.speakers.flatMap((s) => (s.name?.trim() ? [s.name.trim()] : []));
  }
  if (aws.topics !== undefined) session.topics = [...aws.topics];
  return session;
}

/**
 * A newer snapshot of the same session over an older one: every field the
 * newer one has replaces the old value, every field it lacks keeps it
 * (domain.md "Session snapshots merge forward").
 *
 * The one exception is the time: a start and an end are one fact, so a newer
 * start brings its own end, or none, rather than pairing with the old end.
 */
export function mergeSnapshot(existing: Session, incoming: Session): Session {
  const merged: Session = { ...existing };
  for (const [key, value] of Object.entries(incoming)) {
    if (value !== undefined) (merged as unknown as Record<string, unknown>)[key] = value;
  }
  if (incoming.startsAt !== undefined && incoming.endsAt === undefined) delete merged.endsAt;
  return merged;
}

/**
 * One attendee's account of a session: their agent's snapshots of it, merged
 * forward, and when the last one came. The catalog keeps one per reporter and
 * shows their `consensus`, so no single agent decides what a shared session is.
 */
export interface SessionReport extends Session {
  attendeeId: string;
  reportedAt: string;
}

/**
 * The parts of a session reporters vote on, each as one value. The start and
 * the end are one fact (as in `mergeSnapshot`): a report's time is its pair.
 */
const ballot: readonly (readonly (keyof Session)[])[] = [
  ["code"],
  ["title"],
  ["type"],
  ["level"],
  ["venue"],
  ["room"],
  ["isAllDay"],
  ["speakers"],
  ["topics"],
  ["startsAt", "endsAt"],
];

/**
 * The session everyone sees, from every attendee's report of it (domain.md
 * "The catalog is what reporters agree on"). Per field, the value the most
 * reports carry wins; a tie goes to the value whose latest report is newest.
 * A report without a field does not vote on it. So one reporter cannot
 * override two, and a lone reporter decides only a session no one else
 * reported. `reports` are of one session and not empty.
 *
 * The D1 repository computes the same thing in SQL inside the sync's batch;
 * schedule-repository.test.ts holds the two to the same answers.
 */
export function consensus(reports: readonly SessionReport[]): Session {
  const { sessionId, eventId } = reports[0]!;
  const session: Session = { sessionId, eventId };
  for (const fields of ballot) {
    const tally = new Map<string, { votes: number; latest: string; values: Partial<Session> }>();
    for (const report of reports) {
      if (report[fields[0]!] === undefined) continue;
      const values = Object.fromEntries(fields.map((field) => [field, report[field]]));
      const key = JSON.stringify(fields.map((field) => report[field] ?? null));
      const count = tally.get(key);
      if (!count) tally.set(key, { votes: 1, latest: report.reportedAt, values });
      else {
        count.votes++;
        if (report.reportedAt > count.latest) count.latest = report.reportedAt;
      }
    }
    const [winner] = [...tally.entries()].sort(
      ([keyA, a], [keyB, b]) =>
        b.votes - a.votes || (a.latest === b.latest ? 0 : a.latest > b.latest ? -1 : 1) || (keyA < keyB ? -1 : 1),
    );
    if (winner) {
      for (const [field, value] of Object.entries(winner[1].values)) {
        if (value !== undefined) (session as unknown as Record<string, unknown>)[field] = value;
      }
    }
  }
  return session;
}

/**
 * Text as search compares it: NFKD, combining marks removed, lowercased with
 * Unicode's rules, so "Ångström", "ångström" and "angstrom" are one word. The
 * catalog stores the code, title and speakers folded when it writes a
 * session, and a query is folded the same way (domain.md `SearchSessions`).
 */
export function foldText(text: string): string {
  return text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
}

/** A session's speakers as one folded text, one name a line, for search. */
export const foldSpeakers = (speakers: readonly string[]) => foldText(speakers.join("\n"));

/**
 * The link to a session on the re:Invent site: `template` with `{code}`
 * replaced. The template is configuration (SESSION_URL_TEMPLATE) because the
 * site's deep-link format is not confirmed; a template without `{code}` would
 * send every session to the same page, so it is refused loudly.
 */
export function sessionUrl(code: string, template: string): string {
  if (!template.includes("{code}")) {
    throw new Error("SESSION_URL_TEMPLATE must contain {code}");
  }
  return template.replaceAll("{code}", encodeURIComponent(code));
}
