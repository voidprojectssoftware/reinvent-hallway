import { describe, expect, it } from "vitest";
import { formatDay, formatTime, zoneAbbreviation } from "./time.ts";

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
