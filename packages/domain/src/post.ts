// Telling people which sessions I am going to (issue #78, ADR 0026): what a
// selection of my week is, and the post text Hallway prefills for it. The
// person edits the text before anything is posted; this is the starting point,
// and the one place that decides what a session line says. It is built from a
// session's place and time only, so an abstract can never be in it.
import { toLocal } from "./time";

/** LinkedIn caps a post's commentary at 3,000 characters. */
export const postTextLimit = 3000;

/** What part of my week a post or a picture is about. */
export type ShareSelection =
  | { kind: "week" }
  /** An event-local date, "2026-12-01". */
  | { kind: "day"; day: string }
  /** Sessions I chose, in my week's order whatever order they were picked in. */
  | { kind: "sessions"; sessionIds: string[] };

/** The fields of a session a post line uses. */
export interface PostSession {
  sessionId: string;
  code?: string | undefined;
  title?: string | undefined;
  venue?: string | undefined;
  startsAt?: string | undefined;
  isAllDay?: boolean | undefined;
}

/**
 * The entries a selection takes from `entries`, in their order. `entries` are
 * already what may leave Hallway (`shareableEntries`), so a hidden session is
 * never offered and never selected, even by id.
 */
export function selectEntries<T extends { session: PostSession }>(
  entries: readonly T[],
  selection: ShareSelection,
  timezone: string,
): T[] {
  switch (selection.kind) {
    case "week":
      return [...entries];
    case "day":
      return entries.filter(
        ({ session }) => session.startsAt !== undefined && toLocal(session.startsAt, timezone).date === selection.day,
      );
    case "sessions": {
      const chosen = new Set(selection.sessionIds);
      return entries.filter(({ session }) => chosen.has(session.sessionId));
    }
  }
}

export interface PostTextInput {
  /** "re:Invent 2026" */
  eventName: string;
  timezone: string;
  selection: ShareSelection;
  /** The selected sessions, in the order to list them. */
  sessions: readonly PostSession[];
  /** My `/@handle` page. */
  pageUrl: string;
}

/** A calendar date's own names, read at noon UTC so no zone moves it. */
const dateName = (day: string, options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", ...options }).format(new Date(`${day}T12:00:00Z`));

/** "Tue 1 Dec, 10:00 AM: Building agents (AIM3315), Venetian" */
export function postLine(session: PostSession, timezone: string): string {
  const name = session.title ?? session.code ?? "A session";
  const named = session.title && session.code ? `${session.title} (${session.code})` : name;
  const place = session.venue ? `, ${session.venue}` : "";
  if (!session.startsAt) return `${named}${place}`;
  const day = dateName(toLocal(session.startsAt, timezone).date, { weekday: "short", day: "numeric", month: "short" });
  const time = session.isAllDay
    ? "all day"
    : new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "numeric", minute: "2-digit" }).format(
        new Date(session.startsAt),
      );
  return `${day}, ${time}: ${named}${place}`;
}

function opening({ eventName, selection, sessions }: PostTextInput): string {
  switch (selection.kind) {
    case "week":
      return `Where I'll be at ${eventName}:`;
    case "day":
      return `Where I'll be at ${eventName} on ${dateName(selection.day, { weekday: "long", day: "numeric", month: "long" })}:`;
    case "sessions":
      return sessions.length === 1 ? `I'm going to this session at ${eventName}:` : `Sessions I'm going to at ${eventName}:`;
  }
}

/**
 * The prefilled post: an opening line, one line per session in Las Vegas
 * time, and my page's link. When the list would take it past the limit, the
 * last sessions give way to "and N more", so the link always fits.
 */
export function postText(input: PostTextInput): string {
  const lines = input.sessions.map((session) => `• ${postLine(session, input.timezone)}`);
  const closing = `Times are Las Vegas time. See my week on Hallway: ${input.pageUrl}`;
  const compose = (shown: number) => {
    const rest = lines.length - shown;
    const list = [...lines.slice(0, shown), ...(rest > 0 ? [`and ${rest} more`] : [])];
    return [opening(input), "", ...list, "", closing].join("\n");
  };
  for (let shown = lines.length; shown > 0; shown -= 1) {
    const text = compose(shown);
    if (text.length <= postTextLimit) return text;
  }
  return compose(0).slice(0, postTextLimit);
}
