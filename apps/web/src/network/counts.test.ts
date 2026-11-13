import { describe, expect, it } from "vitest";
import { sessionCounts } from "./counts.ts";

describe("a connection's session counts", () => {
  it("says it as the design does", () => {
    expect(sessionCounts({ sessions: 9, sharedWithMe: 4 })).toBe("9 sessions · 4 with you");
    expect(sessionCounts({ sessions: 1, sharedWithMe: 1 })).toBe("1 session · 1 with you");
    expect(sessionCounts({ sessions: 3, sharedWithMe: 0 })).toBe("3 sessions");
  });

  it("says the same for a private schedule and an empty one", () => {
    expect(sessionCounts({ sessions: 0, sharedWithMe: 0 })).toBe("No sessions you can see");
    expect(sessionCounts({})).toBe("No sessions you can see");
  });
});
