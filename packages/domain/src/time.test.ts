import { describe, expect, it } from "vitest";
import { dayBounds } from "./time";

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
