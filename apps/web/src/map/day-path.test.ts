import { describe, expect, it } from "vitest";
import type { Session } from "@hallway/contracts";
import { dayPath, formatMinutes as format, legLabel as label } from "./day-path.ts";

// The labels keep "4 h" together with no-break spaces; compared here as plain spaces.
const plain = (text: string) => text.replaceAll("\u00a0", " ");
const formatMinutes = (minutes: number) => plain(format(minutes));
const legLabel = (leg: Parameters<typeof label>[0]) => plain(label(leg));

const venues = {
  venues: ["venetian", "caesars-forum", "mandalay-bay", "wynn"].map((venueId) => ({
    venueId,
    name: venueId,
    osm: { type: "way" as const, id: 1 },
    center: [36.1, -115.17] as [number, number],
    outline: [],
  })),
  walks: [
    { from: "venetian", to: "caesars-forum", meters: 894, minutes: 12 },
    { from: "mandalay-bay", to: "wynn", meters: 5581, minutes: 74 },
  ],
};

// Tuesday 1 December 2026 in Las Vegas (UTC-8).
const at = (hhmm: string) => `2026-12-01T${String(Number(hhmm.slice(0, 2)) + 8).padStart(2, "0")}:${hhmm.slice(3)}:00.000Z`;
const entry = (id: string, venueId: string | undefined, start: string, end: string, extra: Partial<Session> = {}) => ({
  sessionId: id,
  session: { sessionId: id, eventId: "e", code: id, startsAt: at(start), endsAt: at(end), lastSeenAt: at(start), ...(venueId ? { venueId } : {}), ...extra },
});

describe("dayPath", () => {
  it("numbers the day's timed sessions in time order and walks between each two", () => {
    const path = dayPath(
      [entry("C", "wynn", "16:00", "18:00"), entry("A", "venetian", "09:00", "10:00"), entry("B", "caesars-forum", "10:20", "11:00")],
      "2026-12-01",
      venues,
    );
    expect(path.stops.map((s) => [s.entry.sessionId, s.number])).toEqual([["A", 1], ["B", 2], ["C", 3]]);
    expect(path.legs[0]).toMatchObject({ walk: { kind: "walk", minutes: 12 }, gap: 20, tight: false });
  });

  it("calls a leg tight when the walk is longer than the gap, and not when it is equal", () => {
    const tight = dayPath([entry("A", "mandalay-bay", "14:00", "15:00"), entry("B", "wynn", "16:00", "17:00")], "2026-12-01", venues);
    expect(tight.legs[0]).toMatchObject({ gap: 60, tight: true });
    expect(legLabel(tight.legs[0]!)).toBe("1 h 14 min walk (5.6 km), 1 h between sessions");
    const exact = dayPath([entry("A", "venetian", "09:00", "10:00"), entry("B", "caesars-forum", "10:12", "11:00")], "2026-12-01", venues);
    expect(exact.legs[0]).toMatchObject({ gap: 12, tight: false });
  });

  it("puts sessions at one venue on one pin, and a session it cannot place under unplaced", () => {
    const path = dayPath(
      [
        entry("A", "venetian", "09:00", "10:00"),
        entry("X", undefined, "10:30", "11:00", { venue: "Las Vegas Festival Grounds" }),
        entry("B", "venetian", "13:00", "14:00"),
        entry("E", "venetian", "00:00", "23:59", { isAllDay: true }),
      ],
      "2026-12-01",
      venues,
    );
    expect(path.pins).toEqual([{ venueId: "venetian", entries: [path.stops[0]!.entry, path.stops[2]!.entry, path.allDay[0]], numbers: [1, 3] }]);
    expect(path.unplaced.map((e) => e.sessionId)).toEqual(["X"]);
    expect(path.legs.map((leg) => leg.walk.kind)).toEqual(["unknown", "unknown"]);
    expect(path.allDay.map((e) => e.sessionId)).toEqual(["E"]);
  });

  it("says when a session starts before the last ends, and the same venue needs no walk", () => {
    const path = dayPath(
      [entry("A", "venetian", "09:00", "10:00"), entry("B", "venetian", "09:30", "10:30"), entry("C", "venetian", "11:00", "12:00")],
      "2026-12-01",
      venues,
    );
    expect(path.legs[0]).toMatchObject({ gap: -30, tight: true });
    expect(legLabel(path.legs[0]!)).toBe("Starts before the one before it ends");
    expect(legLabel(path.legs[1]!)).toBe("Same venue, 30 min between sessions");
  });

  it("leaves out other days", () => {
    expect(dayPath([entry("A", "venetian", "09:00", "10:00")], "2026-12-02", venues).stops).toEqual([]);
  });
});

describe("formatMinutes", () => {
  it.each([
    [0, "0 min"],
    [45, "45 min"],
    [60, "1 h"],
    [90, "1 h 30 min"],
  ])("%i is %s", (minutes, text) => expect(formatMinutes(minutes)).toBe(text));
});
