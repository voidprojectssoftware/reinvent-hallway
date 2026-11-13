import { describe, expect, it } from "vitest";
import { backLabel, openedFrom, type Visits } from "./back.ts";

describe("the way back", () => {
  const visits: Visits = {
    week: { title: "My week" },
    session: { title: "AIM3315", from: "week" },
  };

  it("goes back to the screen a push came from", () => {
    expect(openedFrom(visits, "ben", "PUSH", "session")).toBe("session");
  });

  it("keeps the way back of a screen a replace took the place of", () => {
    // The day chips and the invite cleanup replace the entry they are on.
    expect(openedFrom(visits, "session-2", "REPLACE", "session")).toBe("week");
  });

  it("remembers an entry it has seen, whatever was shown just before", () => {
    expect(openedFrom(visits, "session", "POP", "ben")).toBe("week");
  });

  it("has no way back for a link opened cold", () => {
    expect(openedFrom({}, "first", "POP", null)).toBeUndefined();
    expect(openedFrom(visits, "elsewhere", "POP", "week")).toBeUndefined();
  });

  it("names a short screen and says Back for a long one, as iOS does", () => {
    expect(backLabel("Ben Okafor")).toBe("Ben Okafor");
    expect(backLabel("Network")).toBe("Network");
    expect(backLabel("Daniela Alexandra Montgomery-Featherstonehaugh III")).toBe("Back");
  });
});
