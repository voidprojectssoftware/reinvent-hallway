import { describe, expect, it } from "vitest";
import { syncCounts } from "./sync.ts";

const last = { syncedAt: "2026-11-13T10:00:00.000Z", added: 3, removed: 1, changed: 0, unchanged: 10, missingSessions: 0 };

describe("the last sync's counts", () => {
  it("reads as the design words them", () => {
    expect(syncCounts(last)).toBe("3 added, 1 removed, 10 unchanged");
  });

  it("names changed and skipped sessions only when there were some", () => {
    expect(syncCounts({ ...last, changed: 2, missingSessions: 1 })).toBe("3 added, 1 removed, 2 changed, 10 unchanged, 1 skipped without details");
  });
});
