import { describe, expect, it } from "vitest";
import type { PlanEntry, Visibility } from "./types";
import { canViewSchedule, noTie, shareableEntries, visibleEntries, type Tie } from "./visibility";

const owner = (visibility: Visibility) => ({ id: "owner", visibility });
const connected: Tie = { connected: true, followedByOwner: false };
const followedByOwner: Tie = { connected: false, followedByOwner: true };

describe("canViewSchedule", () => {
  // viewer, tie, public, network, private
  it.each([
    ["the owner", "owner", noTie, true, true, true],
    ["a connection", "friend", connected, true, true, false],
    ["someone the owner follows", "followed", followedByOwner, true, true, false],
    ["a signed-in stranger, or someone who only follows the owner", "stranger", noTie, true, false, false],
    ["an anonymous viewer", null, noTie, true, false, false],
  ] as const)("%s", (_who, viewer, tie, pub, network, priv) => {
    expect(canViewSchedule(viewer, owner("public"), tie)).toBe(pub);
    expect(canViewSchedule(viewer, owner("network"), tie)).toBe(network);
    expect(canViewSchedule(viewer, owner("private"), tie)).toBe(priv);
  });

  it("an anonymous viewer is never in anyone's network, whatever the caller says", () => {
    expect(canViewSchedule(null, owner("network"), { connected: true, followedByOwner: true })).toBe(false);
  });
});

describe("visibleEntries", () => {
  const entry = (sessionId: string, hidden: boolean): PlanEntry => ({
    attendeeId: "owner",
    sessionId,
    intent: "interested",
    source: "agent-sync",
    invited: false,
    hidden,
    addedAt: "2026-11-13T00:00:00.000Z",
  });
  const entries = [entry("shown", false), entry("secret", true)];
  const ids = (list: PlanEntry[]) => list.map((e) => e.sessionId);

  it("the owner sees hidden entries too", () => {
    expect(ids(visibleEntries("owner", owner("private"), entries, noTie))).toEqual(["shown", "secret"]);
  });

  it("anyone else never sees a hidden entry, even on a public schedule", () => {
    expect(ids(visibleEntries(null, owner("public"), entries, noTie))).toEqual(["shown"]);
    expect(ids(visibleEntries("friend", owner("network"), entries, connected))).toEqual(["shown"]);
    expect(ids(visibleEntries("followed", owner("network"), entries, followedByOwner))).toEqual(["shown"]);
  });

  it("a schedule not visible to the viewer yields nothing", () => {
    expect(visibleEntries("stranger", owner("network"), entries, noTie)).toEqual([]);
    expect(visibleEntries("friend", owner("private"), entries, connected)).toEqual([]);
    expect(visibleEntries("followed", owner("private"), entries, followedByOwner)).toEqual([]);
  });
});

describe("shareableEntries", () => {
  const entry = (sessionId: string, hidden: boolean): PlanEntry => ({
    attendeeId: "owner",
    sessionId,
    intent: "reserved",
    source: "manual",
    invited: false,
    hidden,
    addedAt: "2026-11-13T00:00:00.000Z",
  });
  const entries = [entry("shown", false), entry("secret", true)];
  const ids = (list: PlanEntry[]) => list.map((e) => e.sessionId);

  it("leaves a hidden entry out even for the owner, who is about to show it to others", () => {
    expect(ids(shareableEntries("owner", owner("private"), entries, noTie))).toEqual(["shown"]);
  });

  it("is empty for a viewer who may not see the schedule", () => {
    expect(shareableEntries(null, owner("network"), entries, noTie)).toEqual([]);
    expect(shareableEntries("friend", owner("network"), entries, connected).map((e) => e.sessionId)).toEqual(["shown"]);
  });
});
