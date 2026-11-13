import { describe, expect, it } from "vitest";
import { descriptionReader } from "./reader.ts";

const lastSync = { syncedAt: "2026-11-13T20:00:00Z", added: 3, removed: 0, changed: 0, unchanged: 0, missingSessions: 0 };

describe("descriptionReader (issue #88)", () => {
  it("tells apart the four places a reader can stand", () => {
    expect(descriptionReader(null)).toBe("signed-out");
    expect(descriptionReader({ readsAbstracts: false })).toBe("never-synced");
    expect(descriptionReader({ lastSync, readsAbstracts: false })).toBe("unconfirmed");
    expect(descriptionReader({ lastSync, readsAbstracts: true })).toBe("confirmed");
  });
});
