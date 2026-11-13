import type { Session } from "@hallway/contracts";
import { describe, expect, it } from "vitest";
import { hoursShown, inSlot, layoutDay, parseSlot, slotParam, spanOf, type Span } from "./calendar.ts";

const session = (startsAt?: string, endsAt?: string, extra: Partial<Session> = {}): Session => ({
  sessionId: "s",
  eventId: "reinvent2026",
  startsAt,
  endsAt,
  lastSeenAt: "2026-11-13T12:00:00Z",
  ...extra,
});

// Las Vegas is UTC-8 in December: 16:00Z is 8:00 AM.
const at = (date: string, clock: string) => `${date}T${clock}:00-08:00`;
const span = (start: number, end: number): Span => ({ date: "2026-12-01", start, end, crossesMidnight: false, endKnown: true });
const item = (id: string, start: number, end: number) => ({ id, span: span(start, end) });

describe("where a session sits", () => {
  it("places a session by its Las Vegas clock, whatever zone the instant is written in", () => {
    expect(spanOf(session("2026-12-01T16:30:00Z", "2026-12-01T17:30:00Z"))).toEqual({
      date: "2026-12-01",
      start: 8 * 60 + 30,
      end: 9 * 60 + 30,
      crossesMidnight: false,
      endKnown: true,
    });
  });

  it("draws a session crossing midnight to the end of its first day, and says it does", () => {
    expect(spanOf(session(at("2026-12-01", "23:30"), at("2026-12-02", "00:30")))).toMatchObject({
      date: "2026-12-01",
      start: 23 * 60 + 30,
      end: 24 * 60,
      crossesMidnight: true,
    });
  });

  it("gives a session with no end one slot, marked as having no end", () => {
    expect(spanOf(session(at("2026-12-01", "10:00")))).toMatchObject({ start: 600, end: 630, endKnown: false });
  });

  it("leaves all-day and untimed sessions off the grid", () => {
    expect(spanOf(session(at("2026-12-01", "00:00"), undefined, { isAllDay: true }))).toBeNull();
    expect(spanOf(session())).toBeNull();
  });
});

describe("the hours shown", () => {
  it("is at least 8:00 to 18:00", () => {
    expect(hoursShown([span(600, 660)])).toEqual({ start: 480, end: 1080 });
    expect(hoursShown([])).toEqual({ start: 480, end: 1080 });
  });

  it("widens to the earliest start and latest end, on the hour", () => {
    expect(hoursShown([span(7 * 60 + 30, 8 * 60), span(19 * 60 + 30, 21 * 60 + 15)])).toEqual({ start: 420, end: 22 * 60 });
  });
});

describe("laying out a day", () => {
  it("gives sessions that do not overlap the full width", () => {
    const { placed, more } = layoutDay([item("a", 480, 540), item("b", 540, 600)], 4);
    expect(placed.map(({ item, lane, lanes }) => [item.id, lane, lanes])).toEqual([
      ["a", 0, 1],
      ["b", 0, 1],
    ]);
    expect(more).toEqual([]);
  });

  it("puts overlapping sessions side by side, reusing a lane once it is free", () => {
    // a 8:00-9:00, b 8:30-9:30, c 9:00-10:00: one cluster of two lanes; c takes a's lane.
    const { placed } = layoutDay([item("a", 480, 540), item("b", 510, 570), item("c", 540, 600)], 4);
    expect(placed.map(({ item, lane, lanes }) => [item.id, lane, lanes])).toEqual([
      ["a", 0, 2],
      ["b", 1, 2],
      ["c", 0, 2],
    ]);
  });

  it("keeps a crowded slot tappable: the lanes that fit, then +N more per slot for the rest", () => {
    const crowded = Array.from({ length: 6 }, (_, i) => item(`s${i}`, 540, 600)).concat(item("late", 570, 600));
    const { placed, more } = layoutDay(crowded, 3);
    expect(placed).toHaveLength(2);
    expect(placed.every(({ lanes }) => lanes === 3)).toBe(true);
    expect(more).toEqual([
      { start: 540, count: 4, lane: 2, lanes: 3 },
      { start: 570, count: 1, lane: 2, lanes: 3 },
    ]);
  });

  it("handles 44 sessions in a day without losing one", () => {
    const day = Array.from({ length: 44 }, (_, i) => item(`s${i}`, 480 + (i % 11) * 30, 480 + (i % 11) * 30 + 60));
    const { placed, more } = layoutDay(day, 5);
    expect(placed.length + more.reduce((sum, slot) => sum + slot.count, 0)).toBe(44);
    // Never narrower than a fifth of the day, and the last lane is left for +N more.
    expect(placed.every(({ lane, lanes }) => lanes <= 5 && lane < 4)).toBe(true);
    expect(more.length).toBeGreaterThan(0);
  });
});

describe("a slot from +N more", () => {
  it("finds the sessions on during that half hour", () => {
    const nine = session(at("2026-12-01", "09:00"), at("2026-12-01", "10:00"));
    expect(inSlot(nine, "2026-12-01", 9 * 60 + 30)).toBe(true);
    expect(inSlot(nine, "2026-12-01", 10 * 60)).toBe(false);
    expect(inSlot(nine, "2026-12-02", 9 * 60 + 30)).toBe(false);
  });

  it("round-trips through the URL and refuses anything else", () => {
    expect(slotParam(570)).toBe("09:30");
    expect(parseSlot("09:30")).toBe(570);
    expect(parseSlot("09:15")).toBeNull();
    expect(parseSlot("25:00")).toBeNull();
    expect(parseSlot(null)).toBeNull();
  });
});
