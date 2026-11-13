import { describe, expect, it } from "vitest";
import { findGaps, type Placed } from "./gaps";

const TZ = "America/Los_Angeles";

// Local "HH:MM" on 2026-12-01 (PST, UTC-8) as a UTC instant.
const at = (time: string, date = "2026-12-01") => {
  const [h, m] = time.split(":").map(Number) as [number, number];
  const [y, mo, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, mo - 1, d, h + 8, m)).toISOString();
};
const block = (start: string, end: string, endDate?: string): Placed => ({ startsAt: at(start), endsAt: at(end, endDate) });
const local = (gaps: { start: string; end: string }[]) => gaps.map((g) => `${g.start}-${g.end}`);

describe("findGaps", () => {
  it("an empty day is one gap, the whole window", () => {
    const gaps = findGaps([], [], "2026-12-01", "08:00", "18:00", 30, TZ);
    expect(gaps).toEqual([{ start: "08:00", end: "18:00", startsAt: at("08:00"), endsAt: at("18:00") }]);
  });

  it("windows when neither of us is busy, overlaps merged", () => {
    const mine = [block("09:00", "10:00"), block("13:00", "14:00")];
    const theirs = [block("09:30", "11:00"), block("15:00", "16:00")];
    expect(local(findGaps(mine, theirs, "2026-12-01", "08:00", "18:00", 30, TZ))).toEqual([
      "08:00-09:00",
      "11:00-13:00",
      "14:00-15:00",
      "16:00-18:00",
    ]);
  });

  it("drops gaps shorter than minMinutes, keeps one exactly that long", () => {
    const mine = [block("08:00", "09:00"), block("09:20", "10:00"), block("10:30", "18:00")];
    expect(local(findGaps(mine, [], "2026-12-01", "08:00", "18:00", 30, TZ))).toEqual(["10:00-10:30"]);
  });

  it("back-to-back sessions leave no gap between them", () => {
    const mine = [block("08:00", "09:00"), block("09:00", "10:00")];
    expect(local(findGaps(mine, [], "2026-12-01", "08:00", "10:00", 1, TZ))).toEqual([]);
  });

  it("clips sessions to the window, including one that runs past midnight", () => {
    const late = block("17:00", "00:30", "2026-12-02");
    expect(local(findGaps([late], [], "2026-12-01", "08:00", "23:59", 30, TZ))).toEqual(["08:00-17:00"]);
    const early = block("07:00", "08:30");
    expect(local(findGaps([early], [], "2026-12-01", "08:00", "10:00", 30, TZ))).toEqual(["08:30-10:00"]);
  });

  it("the day is the event-local day: 17:00 local is already tomorrow in UTC", () => {
    const evening = block("17:00", "18:00");
    expect(evening.startsAt).toBe("2026-12-02T01:00:00.000Z");
    expect(local(findGaps([evening], [], "2026-12-01", "16:00", "19:00", 30, TZ))).toEqual(["16:00-17:00", "18:00-19:00"]);
  });

  it("sessions on another day do not block", () => {
    const tomorrow = { startsAt: at("10:00", "2026-12-02"), endsAt: at("11:00", "2026-12-02") };
    expect(local(findGaps([tomorrow], [], "2026-12-01", "08:00", "18:00", 30, TZ))).toEqual(["08:00-18:00"]);
  });

  it("all-day sessions and sessions that cannot be placed do not block", () => {
    const allDay: Placed = { startsAt: at("00:00"), endsAt: at("00:00", "2026-12-02"), isAllDay: true };
    const noEnd: Placed = { startsAt: at("10:00") };
    const nowhere: Placed = {};
    expect(local(findGaps([allDay, noEnd], [nowhere], "2026-12-01", "08:00", "18:00", 30, TZ))).toEqual(["08:00-18:00"]);
  });

  it("an empty or unreadable window has no gaps", () => {
    expect(findGaps([], [], "2026-12-01", "18:00", "08:00", 30, TZ)).toEqual([]);
    expect(findGaps([], [], "2026-12-01", "8am", "18:00", 30, TZ)).toEqual([]);
    expect(findGaps([], [], "Tuesday", "08:00", "18:00", 30, TZ)).toEqual([]);
  });
});
