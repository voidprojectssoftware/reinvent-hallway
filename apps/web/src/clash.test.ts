import type { PlanEntry } from "@hallway/contracts";
import { describe, expect, it } from "vitest";
import { clashes, clashLabel } from "./clash.ts";

function entry(sessionId: string, code: string | undefined, startsAt?: string, endsAt?: string, extra: Partial<PlanEntry["session"]> = {}): PlanEntry {
  return {
    sessionId,
    intent: "interested",
    source: "agent-sync",
    hidden: false,
    addedAt: "2026-11-13T12:00:00Z",
    session: { sessionId, eventId: "reinvent2026", code, title: `Title of ${sessionId}`, startsAt, endsAt, lastSeenAt: "2026-11-13T12:00:00Z", ...extra },
  };
}

describe("clashes", () => {
  it("flags two entries that overlap, each naming the other by code", () => {
    const found = clashes([
      entry("a", "AIM3315", "2026-12-01T19:30:00Z", "2026-12-01T20:30:00Z"),
      entry("b", "SVS401", "2026-12-01T20:00:00Z", "2026-12-01T21:00:00Z"),
      entry("c", "DAT327", "2026-12-01T21:00:00Z", "2026-12-01T22:00:00Z"),
    ]);
    expect(Object.fromEntries(found)).toEqual({ a: ["SVS401"], b: ["AIM3315"] });
  });

  it("does not flag one session ending as the next starts", () => {
    expect(clashes([entry("a", "A1", "2026-12-01T19:00:00Z", "2026-12-01T20:00:00Z"), entry("b", "B1", "2026-12-01T20:00:00Z", "2026-12-01T21:00:00Z")]).size).toBe(0);
  });

  it("ignores all-day sessions and sessions without times", () => {
    const found = clashes([
      entry("a", "A1", "2026-12-01T19:00:00Z", "2026-12-01T20:00:00Z"),
      entry("expo", "EXPO", "2026-12-01T16:00:00Z", "2026-12-02T02:00:00Z", { isAllDay: true }),
      entry("tba", "TBA1"),
    ]);
    expect(found.size).toBe(0);
  });

  it("names a session by its title when it has no code", () => {
    const found = clashes([entry("a", "A1", "2026-12-01T19:00:00Z", "2026-12-01T20:00:00Z"), entry("b", undefined, "2026-12-01T19:30:00Z", "2026-12-01T20:30:00Z")]);
    expect(found.get("a")).toEqual(["Title of b"]);
  });
});

describe("clashLabel", () => {
  it("lists one, two or more names as a sentence", () => {
    expect(clashLabel(["SVS401"])).toBe("Same time as SVS401");
    expect(clashLabel(["SVS401", "DAT327"])).toBe("Same time as SVS401 and DAT327");
    expect(clashLabel(["A", "B", "C"])).toBe("Same time as A, B and C");
  });
});
