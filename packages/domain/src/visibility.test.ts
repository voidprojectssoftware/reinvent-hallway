import { describe, expect, it } from "vitest";
import type { PlanEntry, Visibility } from "./types";
import { canViewSchedule, visibleEntries } from "./visibility";

const owner = (visibility: Visibility) => ({ id: "owner", visibility });

describe("canViewSchedule", () => {
  // viewer, connected, public, connections, private
  it.each([
    ["the owner", "owner", false, true, true, true],
    ["a connection", "friend", true, true, true, false],
    ["a signed-in stranger", "stranger", false, true, false, false],
    ["an anonymous viewer", null, false, true, false, false],
  ] as const)("%s", (_who, viewer, connected, pub, conn, priv) => {
    expect(canViewSchedule(viewer, owner("public"), connected)).toBe(pub);
    expect(canViewSchedule(viewer, owner("connections"), connected)).toBe(conn);
    expect(canViewSchedule(viewer, owner("private"), connected)).toBe(priv);
  });

  it("an anonymous viewer is never a connection, whatever the caller says", () => {
    expect(canViewSchedule(null, owner("connections"), true)).toBe(false);
  });
});

describe("visibleEntries", () => {
  const entry = (sessionId: string, hidden: boolean): PlanEntry => ({
    attendeeId: "owner",
    sessionId,
    intent: "interested",
    source: "agent-sync",
    hidden,
    addedAt: "2026-11-13T00:00:00.000Z",
  });
  const entries = [entry("shown", false), entry("secret", true)];
  const ids = (list: PlanEntry[]) => list.map((e) => e.sessionId);

  it("the owner sees hidden entries too", () => {
    expect(ids(visibleEntries("owner", owner("private"), entries, false))).toEqual(["shown", "secret"]);
  });

  it("anyone else never sees a hidden entry, even on a public schedule", () => {
    expect(ids(visibleEntries(null, owner("public"), entries, false))).toEqual(["shown"]);
    expect(ids(visibleEntries("friend", owner("connections"), entries, true))).toEqual(["shown"]);
  });

  it("a schedule not visible to the viewer yields nothing", () => {
    expect(visibleEntries("stranger", owner("connections"), entries, false)).toEqual([]);
    expect(visibleEntries("friend", owner("private"), entries, true)).toEqual([]);
  });
});
