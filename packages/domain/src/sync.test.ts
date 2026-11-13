import { describe, expect, it } from "vitest";
import { planSync } from "./sync";
import type { EntrySource, Intent, PlanEntry } from "./types";

const entry = (sessionId: string, intent: Intent, source: EntrySource = "agent-sync", hidden = false): PlanEntry => ({
  attendeeId: "me",
  sessionId,
  intent,
  source,
  hidden,
  addedAt: "2026-11-01T00:00:00.000Z",
});

describe("planSync", () => {
  it("into an empty plan adds everything sent", () => {
    expect(planSync([], { favorites: ["a", "b"], reserved: ["c"] })).toEqual({
      add: [
        { sessionId: "a", intent: "interested" },
        { sessionId: "b", intent: "interested" },
        { sessionId: "c", intent: "reserved" },
      ],
      remove: [],
      update: [],
      unchanged: [],
    });
  });

  it("reserved beats interested when a session is in both lists", () => {
    expect(planSync([], { favorites: ["a"], reserved: ["a"] }).add).toEqual([{ sessionId: "a", intent: "reserved" }]);
  });

  it("removes agent-sync entries no longer sent, keeps the ones still sent", () => {
    const keep = entry("keep", "interested");
    const drop = entry("drop", "reserved");
    const plan = planSync([keep, drop], { favorites: ["keep"], reserved: [] });
    expect(plan.remove).toEqual([drop]);
    expect(plan.unchanged).toEqual([keep]);
    expect(plan.add).toEqual([]);
  });

  it("changes intent in place, keeping the hidden flag and addedAt", () => {
    const hidden = entry("a", "interested", "agent-sync", true);
    const plan = planSync([hidden], { favorites: [], reserved: ["a"] });
    expect(plan.update).toEqual([{ ...hidden, intent: "reserved" }]);
    expect(plan.add).toEqual([]);
  });

  it("a cancelled reservation that is still a favorite drops back to interested", () => {
    const plan = planSync([entry("a", "reserved")], { favorites: ["a"], reserved: [] });
    expect(plan.update).toEqual([entry("a", "interested")]);
  });

  it("never removes a manual entry, sent or not", () => {
    const manualSent = entry("m1", "interested", "manual");
    const manualNotSent = entry("m2", "reserved", "manual");
    const plan = planSync([manualSent, manualNotSent], { favorites: ["m1"], reserved: [] });
    expect(plan.remove).toEqual([]);
    expect(plan.update).toEqual([]);
    expect(plan.unchanged).toEqual([manualSent]);
  });

  it("raises a manual entry to reserved when AWS says it is reserved, keeping source, hidden and addedAt", () => {
    const manual = entry("m", "interested", "manual", true);
    const plan = planSync([manual], { favorites: [], reserved: ["m"] });
    expect(plan.update).toEqual([{ ...manual, intent: "reserved" }]);
    expect(plan.add).toEqual([]);
    expect(plan.unchanged).toEqual([]);
  });

  it("never lowers a manual reservation, whether AWS sends it as a favorite or not at all", () => {
    const sentAsFavorite = entry("m1", "reserved", "manual");
    const notSent = entry("m2", "reserved", "manual");
    const plan = planSync([sentAsFavorite, notSent], { favorites: ["m1"], reserved: [] });
    expect(plan.update).toEqual([]);
    expect(plan.remove).toEqual([]);
    expect(plan.unchanged).toEqual([sentAsFavorite]);
  });

  it("a manual entry already reserved and sent as reserved is unchanged", () => {
    const manual = entry("m", "reserved", "manual");
    expect(planSync([manual], { favorites: [], reserved: ["m"] }).unchanged).toEqual([manual]);
  });

  it("never duplicates: a session already on the plan, manual or synced, is not added again", () => {
    const plan = planSync([entry("m", "interested", "manual"), entry("s", "interested")], {
      favorites: ["m", "s"],
      reserved: [],
    });
    expect(plan.add).toEqual([]);
  });

  it("repeated ids in the lists are one session", () => {
    expect(planSync([], { favorites: ["a", "a"], reserved: [] }).add).toHaveLength(1);
  });

  it("sending nothing removes every agent-sync entry and only those", () => {
    const synced = entry("s", "reserved");
    const plan = planSync([synced, entry("m", "interested", "manual")], { favorites: [], reserved: [] });
    expect(plan.remove).toEqual([synced]);
    expect(plan.unchanged).toEqual([]);
  });

  it("applying the plan and syncing again is a no-op", () => {
    const sent = { favorites: ["a", "b"], reserved: ["b", "c"] };
    const first = planSync([entry("a", "reserved"), entry("z", "interested")], sent);
    const after = [
      ...first.unchanged,
      ...first.update,
      ...first.add.map((a) => entry(a.sessionId, a.intent)),
    ];
    const second = planSync(after, sent);
    expect(second.add).toEqual([]);
    expect(second.remove).toEqual([]);
    expect(second.update).toEqual([]);
    expect(second.unchanged).toHaveLength(3);
  });
});
