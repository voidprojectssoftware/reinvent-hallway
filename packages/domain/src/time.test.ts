import { describe, expect, it } from "vitest";
import { dayBounds, localWindow } from "./time";

describe("localWindow", () => {
  it("is the UTC span of a Las Vegas afternoon, and the whole day up to 24:00", () => {
    expect(localWindow("2026-12-01", "13:00", "18:00", "America/Los_Angeles")).toEqual({
      from: "2026-12-01T21:00:00.000Z",
      to: "2026-12-02T02:00:00.000Z",
    });
    expect(localWindow("2026-12-01", "00:00", "24:00", "America/Los_Angeles")).toEqual(
      dayBounds("2026-12-01", "America/Los_Angeles"),
    );
  });

  it("refuses an empty window, a bad time and a bad date", () => {
    expect(localWindow("2026-12-01", "18:00", "13:00", "America/Los_Angeles")).toBeUndefined();
    expect(localWindow("2026-12-01", "25:00", "26:00", "America/Los_Angeles")).toBeUndefined();
    expect(localWindow("2026-02-30", "10:00", "11:00", "America/Los_Angeles")).toBeUndefined();
  });
});

describe("dayBounds", () => {
  it("is local midnight to the next local midnight, in UTC", () => {
    expect(dayBounds("2026-12-01", "America/Los_Angeles")).toEqual({
      from: "2026-12-01T08:00:00.000Z",
      to: "2026-12-02T08:00:00.000Z",
    });
  });

  it("is 25 hours on the day the clocks go back", () => {
    expect(dayBounds("2026-11-01", "America/Los_Angeles")).toEqual({
      from: "2026-11-01T07:00:00.000Z",
      to: "2026-11-02T08:00:00.000Z",
    });
  });

  it("is undefined for a date that does not exist", () => {
    expect(dayBounds("2026-02-30", "America/Los_Angeles")).toBeUndefined();
  });
});
