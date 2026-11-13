import { describe, expect, it } from "vitest";
import { dayChip, eventDate, eventDates, formatAgo, formatDate, formatDay, formatTime, zoneAbbreviation } from "./time.ts";

describe("the event's days", () => {
  it("lists every date of re:Invent from the event's own offset dates", () => {
    expect(eventDates("2026-11-30T05:30-08:00", "2026-12-04T23:59-08:00")).toEqual([
      "2026-11-30",
      "2026-12-01",
      "2026-12-02",
      "2026-12-03",
      "2026-12-04",
    ]);
  });

  it("puts a late session on its Las Vegas date, not UTC's", () => {
    expect(eventDate("2026-12-02T06:30:00Z")).toBe("2026-12-01");
  });

  it("names a date for the day picker and its heading", () => {
    expect(dayChip("2026-12-01")).toEqual({ weekday: "Tue", day: "1" });
    expect(formatDate("2026-11-30")).toBe("Monday 30 November");
  });

  it("says how long ago, in words", () => {
    const now = new Date("2026-11-13T12:00:00Z");
    expect(formatAgo("2026-11-13T11:48:00Z", now)).toBe("12 minutes ago");
    expect(formatAgo("2026-11-13T11:59:30Z", now)).toBe("just now");
    expect(formatAgo("2026-11-13T09:00:00Z", now)).toBe("3 hours ago");
  });
});

// Instants are given in UTC, so these pass in any zone the test runs in: the
// output must be Las Vegas time, never the machine's.
describe("Las Vegas time", () => {
  it("renders the keynote's start as the badge shows it", () => {
    expect(formatTime("2026-12-01T16:00:00Z")).toBe("8:00 AM");
    expect(formatDay("2026-12-01T16:00:00Z")).toBe("Tuesday 1 December");
  });

  it("keeps a late session on its Las Vegas day when UTC has moved on", () => {
    // 06:30 UTC on Wednesday is 10:30 PM on Tuesday in Las Vegas.
    expect(formatTime("2026-12-02T06:30:00Z")).toBe("10:30 PM");
    expect(formatDay("2026-12-02T06:30:00Z")).toBe("Tuesday 1 December");
  });

  it("reads an AWS offset date the same as its UTC instant", () => {
    expect(formatTime("2026-11-30T05:30-08:00")).toBe("5:30 AM");
  });

  it("names the zone for the week of the event", () => {
    expect(zoneAbbreviation("2026-12-01T16:00:00Z")).toBe("PST");
  });
});
