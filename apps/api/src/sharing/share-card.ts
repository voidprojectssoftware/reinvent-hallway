// The share card (ShareImage, domain.md): docs/design/share-card.html drawn as
// a tree Satori lays out (png.ts turns it into a PNG). 1200 by 627, LinkedIn's
// 1.91:1 link image, always the light scheme, nothing under 15 px because the
// feed shows it at half size. Colors are the design's light tokens, written
// out because there is no CSS here.
//
// Two layouts: the week (five day columns, two sessions each, then a count)
// and one day (`?day=`, up to six sessions). A schedule the viewer may not see
// gets the card alone: name, headline, and nothing about the week (design
// README rule 9: no count, no days).
import type { SharedEntry, SharedSchedule } from "@hallway/application";

export const cardWidth = 1200;
export const cardHeight = 627;

const color = {
  bg: "#f2f2f7",
  cell: "#ffffff",
  label: "#000000",
  label2: "rgba(60, 60, 67, 0.78)",
  sep: "rgba(60, 60, 67, 0.18)",
  tint: "#5856d6",
  avatars: ["#5856d6", "#1e7a35", "#b8336a", "#8a5a00", "#0b6e99", "#6b4fbb", "#a04100", "#636366"],
};
const font = "Inter";

type Style = Record<string, string | number>;
type Child = CardNode | string;
/** A node Satori lays out: React's element shape, without React. */
export interface CardNode {
  type: string;
  props: { style?: Style; children?: Child | Child[] };
}

const el = (type: string, style: Style, ...children: Child[]): CardNode => ({
  type,
  // A lone child is passed bare: Satori counts an array as several children,
  // and a block element (the clamped title) may have only one.
  props: { style: { display: "flex", ...style }, children: children.length === 1 ? children[0]! : children },
});

/** Every string a card tree draws. */
export const cardTexts = (node: Child): string[] =>
  typeof node === "string" ? [node] : [node.props.children ?? []].flat().flatMap(cardTexts);

/** The event's days, "2026-11-30" through "2026-12-04", from its own dates. */
export function eventDays(event: SharedSchedule["event"]): string[] {
  const days: string[] = [];
  const last = event.endDate.slice(0, 10);
  for (let day = event.startDate.slice(0, 10); day <= last && days.length < 14; ) {
    days.push(day);
    const next = new Date(`${day}T00:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    day = next.toISOString().slice(0, 10);
  }
  return days;
}

/** Formats in the event's zone: every time on the card is Las Vegas time. */
function clock(timezone: string) {
  const time = new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "numeric", minute: "2-digit" });
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" });
  const zone = new Intl.DateTimeFormat("en-US", { timeZone: timezone, timeZoneName: "short" });
  return {
    time: (instant: string) => time.format(new Date(instant)),
    localDate: (instant: string) => date.format(new Date(instant)),
    zone: (instant: string) => zone.formatToParts(new Date(instant)).find((p) => p.type === "timeZoneName")?.value ?? "",
  };
}

/** A calendar date's own names, read in UTC so no zone moves it. */
const dateName = (day: string, options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", ...options }).format(new Date(`${day}T12:00:00Z`));

/** "30 Nov to 4 Dec" */
export function eventSpan(event: SharedSchedule["event"]): string {
  const days = eventDays(event);
  const short = (day: string) => dateName(day, { day: "numeric", month: "short" });
  return `${short(days[0]!)} to ${short(days[days.length - 1]!)}`;
}

/**
 * Entries by event-local day, only those with a time. All-day sessions (the
 * expo and the like) go after the timed ones: with two slots a day, a session
 * someone chose to be at says more than the hall that is open all week.
 */
export function byDay(entries: SharedEntry[], timezone: string): Map<string, SharedEntry[]> {
  const { localDate } = clock(timezone);
  const days = new Map<string, SharedEntry[]>();
  const ordered = [...entries.filter((e) => !e.session.isAllDay), ...entries.filter((e) => e.session.isAllDay)];
  for (const entry of ordered) {
    if (!entry.session.startsAt) continue;
    const day = localDate(entry.session.startsAt);
    days.set(day, [...(days.get(day) ?? []), entry]);
  }
  return days;
}

function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters = words.length > 1 ? [words[0]!, words[words.length - 1]!] : words.slice(0, 1);
  return letters.map((word) => [...word][0]!.toUpperCase()).join("");
}

/** One of the eight avatar hues, the same one for an attendee every time. */
function hue(id: string): string {
  let sum = 0;
  for (const char of id) sum = (sum * 31 + char.charCodeAt(0)) >>> 0;
  return color.avatars[sum % color.avatars.length]!;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** One session; `ruled` when it sits under a day's heading or another session. */
function sessionBlock(entry: SharedEntry, time: (instant: string) => string, ruled: boolean): CardNode {
  const { session } = entry;
  return el(
    "div",
    { flexDirection: "column", gap: 2, ...(ruled ? { paddingTop: 12, borderTop: `1px solid ${color.sep}` } : {}) },
    el(
      "div",
      { fontSize: 16, fontWeight: 600, color: color.tint, lineHeight: 1.2 },
      session.isAllDay ? "All day" : time(session.startsAt!),
    ),
    // Three lines in the week: at two, most titles lost their subject.
    el(
      "div",
      { display: "block", fontSize: 17, fontWeight: 600, lineHeight: 1.25, lineClamp: 3 },
      session.title ?? session.code ?? "Session",
    ),
    ...(session.venue
      ? [el("div", { fontSize: 15, color: color.label2, lineHeight: 1.25 }, session.venue)]
      : []),
  );
}

const more = (n: number) => el("div", { fontSize: 16, fontWeight: 600, color: color.label2 }, `and ${n} more`);

export interface CardOptions {
  /** One event-local day ("2026-12-01") instead of the week. Must be one of `eventDays`. */
  day?: string;
  /** Where the card says to go: "hallway.example/@sam". */
  pageLabel: string;
}

/**
 * Whether the week card and the link preview show the week, with its count
 * and days: not when the viewer may not see it (design README rule 9), and
 * not when it is empty (issue #41), where "0 sessions" over five blank
 * columns says less than the name alone.
 */
export const showsWeek = (shared: SharedSchedule) => shared.scheduleVisible && shared.entries.length > 0;

export function shareCard(shared: SharedSchedule, { day, pageLabel }: CardOptions): CardNode {
  const { attendee, event } = shared;
  const tz = event.timezone;
  const { time, zone } = clock(tz);
  const days = byDay(shared.entries, tz);

  /** The card without the week: one line in a cell where the days would be. */
  const nameOnly = (line: string) =>
    el(
      "div",
      {
        flexGrow: 1,
        backgroundColor: color.cell,
        borderRadius: 16,
        padding: "0 32px",
        alignItems: "center",
        fontSize: 26,
        color: color.label2,
      },
      line,
    );

  let subtitle = attendee.headline ?? "";
  let body: CardNode;
  if (!shared.scheduleVisible) {
    body = nameOnly(`${attendee.displayName}'s week is on Hallway, for the people they choose.`);
  } else if (day) {
    const list = days.get(day) ?? [];
    const shown = list.slice(0, 6);
    subtitle = [attendee.headline, `${dateName(day, { weekday: "long", day: "numeric", month: "long" })}: ${plural(list.length, "session")}`]
      .filter(Boolean)
      .join(" · ");
    body = el(
      "div",
      { flexGrow: 1, flexDirection: "column", gap: 12, minHeight: 0 },
      el(
        "div",
        { flexWrap: "wrap", gap: 14 },
        ...shown.map((entry) =>
          el(
            "div",
            { width: 362, height: 168, backgroundColor: color.cell, borderRadius: 16, padding: 16, flexDirection: "column", overflow: "hidden" },
            sessionBlock(entry, time, false),
          ),
        ),
      ),
      ...(list.length > shown.length ? [more(list.length - shown.length)] : []),
      ...(list.length === 0 ? [el("div", { fontSize: 22, color: color.label2 }, "Nothing planned this day yet.")] : []),
    );
  } else if (!showsWeek(shared)) {
    body = nameOnly("Nothing planned this week yet.");
  } else {
    subtitle = [attendee.headline, `${plural(shared.entries.length, "session")}, ${eventSpan(event)}`].filter(Boolean).join(" · ");
    body = el(
      "div",
      { flexGrow: 1, gap: 14, minHeight: 0 },
      ...eventDays(event)
        .slice(0, 5)
        .map((d) => {
          const list = days.get(d) ?? [];
          return el(
            "div",
            {
              flex: 1,
              flexDirection: "column",
              gap: 12,
              backgroundColor: color.cell,
              borderRadius: 16,
              padding: "16px 16px 12px",
              overflow: "hidden",
            },
            el(
              "div",
              { fontSize: 20, fontWeight: 600, lineHeight: 1.2, gap: 6 },
              dateName(d, { weekday: "short" }),
              el("span", { fontWeight: 400, color: color.label2 }, dateName(d, { day: "numeric" })),
            ),
            ...list.slice(0, 2).map((entry) => sessionBlock(entry, time, true)),
            ...(list.length > 2 ? [more(list.length - 2)] : []),
          );
        }),
    );
  }

  return el(
    "div",
    {
      width: cardWidth,
      height: cardHeight,
      flexDirection: "column",
      gap: 22,
      padding: "36px 40px 28px",
      backgroundColor: color.bg,
      color: color.label,
      fontFamily: font,
    },
    el(
      "div",
      { alignItems: "center", gap: 20 },
      el(
        "div",
        {
          width: 84,
          height: 84,
          borderRadius: 42,
          backgroundColor: hue(attendee.id),
          color: "#ffffff",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 34,
          fontWeight: 600,
          flexShrink: 0,
        },
        initials(attendee.displayName),
      ),
      el(
        "div",
        { flexDirection: "column", minWidth: 0, flexShrink: 1 },
        el("div", { fontSize: 40, fontWeight: 700, lineHeight: 1.1, letterSpacing: -0.4 }, `${attendee.displayName} at ${event.name}`),
        ...(subtitle ? [el("div", { marginTop: 6, fontSize: 22, lineHeight: 1.3, color: color.label2 }, subtitle)] : []),
      ),
    ),
    body,
    el(
      "div",
      { justifyContent: "space-between", alignItems: "baseline", fontSize: 18, color: color.label2 },
      el(
        "div",
        { alignItems: "baseline", gap: 8 },
        el("span", { fontSize: 22, fontWeight: 700, color: color.label }, "Hallway"),
        // Said once, here, as the design does, and only when there are times.
        // The zone's name comes from the week itself: re:Invent is PST,
        // whatever AWS's own label says.
        ...((day ? shared.scheduleVisible : showsWeek(shared)) ? [`· times are Las Vegas time (${zone(`${eventDays(event)[0]}T20:00:00Z`)})`] : []),
      ),
      el("span", { color: color.tint, fontWeight: 600 }, pageLabel),
    ),
  );
}
