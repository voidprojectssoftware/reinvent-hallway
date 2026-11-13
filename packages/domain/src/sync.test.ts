import { describe, expect, it } from "vitest";
import { manualAfterSync, planSync, syncedSessions, type SyncInput } from "./sync";
import type { EntrySource, Intent, PlanEntry } from "./types";

const entry = (
  sessionId: string,
  intent: Intent,
  source: EntrySource = "agent-sync",
  extra: Partial<PlanEntry> = {},
): PlanEntry => ({
  attendeeId: "me",
  sessionId,
  intent,
  source,
  invited: false,
  hidden: false,
  addedAt: "2026-11-01T00:00:00.000Z",
  ...extra,
});
const sent = (lists: Partial<SyncInput>) => syncedSessions({ favorites: [], reserved: [], invited: [], ...lists });

describe("syncedSessions", () => {
  it("is each session once: reserved beats interested, and an invitation is reserved and marked", () => {
    expect(sent({ favorites: ["a", "b", "c", "a"], reserved: ["b", "c"], invited: ["c", "d"] })).toEqual([
      { sessionId: "a", intent: "interested", invited: false },
      { sessionId: "b", intent: "reserved", invited: false },
      { sessionId: "c", intent: "reserved", invited: true },
      { sessionId: "d", intent: "reserved", invited: true },
    ]);
  });
});

describe("manualAfterSync", () => {
  it("is reserved while the sync says reserved, and the attendee's own intent otherwise (hunt F7)", () => {
    expect(manualAfterSync({ sessionId: "m", intent: "reserved", invited: false })).toEqual({ intent: "reserved", invited: false });
    expect(manualAfterSync({ sessionId: "m", intent: "reserved", invited: true })).toEqual({ intent: "reserved", invited: true });
    expect(manualAfterSync({ sessionId: "m", intent: "interested", invited: false })).toEqual({ intent: "interested", invited: false });
    expect(manualAfterSync(undefined)).toEqual({ intent: "interested", invited: false });
  });
});

describe("planSync", () => {
  it("into an empty plan adds everything sent", () => {
    expect(planSync([], sent({ favorites: ["a", "b"], reserved: ["c"] }))).toEqual({
      add: [
        { sessionId: "a", intent: "interested", invited: false },
        { sessionId: "b", intent: "interested", invited: false },
        { sessionId: "c", intent: "reserved", invited: false },
      ],
      remove: [],
      update: [],
      unchanged: [],
    });
  });

  it("removes agent-sync entries no longer sent, keeps the ones still sent", () => {
    const keep = entry("keep", "interested");
    const drop = entry("drop", "reserved");
    const plan = planSync([keep, drop], sent({ favorites: ["keep"] }));
    expect(plan.remove).toEqual([drop]);
    expect(plan.unchanged).toEqual([keep]);
    expect(plan.add).toEqual([]);
  });

  it("changes intent in place, keeping the hidden state and addedAt", () => {
    const hidden = entry("a", "interested", "agent-sync", { hidden: true });
    const plan = planSync([hidden], sent({ reserved: ["a"] }));
    expect(plan.update).toEqual([{ ...hidden, intent: "reserved" }]);
    expect(plan.add).toEqual([]);
  });

  it("a cancelled reservation that is still a favorite drops back to interested", () => {
    const plan = planSync([entry("a", "reserved")], sent({ favorites: ["a"] }));
    expect(plan.update).toEqual([entry("a", "interested")]);
  });

  it("marks a synced entry invited, and unmarks it, as a change", () => {
    const reservation = entry("a", "reserved");
    expect(planSync([reservation], sent({ invited: ["a"] })).update).toEqual([{ ...reservation, invited: true }]);
    const invitation = entry("a", "reserved", "agent-sync", { invited: true });
    expect(planSync([invitation], sent({ reserved: ["a"] })).update).toEqual([reservation]);
  });

  it("never removes a manual entry, sent or not", () => {
    const manualSent = entry("m1", "interested", "manual");
    const manualNotSent = entry("m2", "interested", "manual");
    const plan = planSync([manualSent, manualNotSent], sent({ favorites: ["m1"] }));
    expect(plan.remove).toEqual([]);
    expect(plan.update).toEqual([]);
    expect(plan.unchanged).toEqual([manualSent]);
  });

  it("raises a manual entry to reserved when AWS says it is reserved, keeping source, hidden and addedAt", () => {
    const manual = entry("m", "interested", "manual", { hidden: true });
    const plan = planSync([manual], sent({ reserved: ["m"] }));
    expect(plan.update).toEqual([{ ...manual, intent: "reserved" }]);
    expect(plan.add).toEqual([]);
    expect(plan.unchanged).toEqual([]);
  });

  it("lowers a raised manual entry back once AWS stops saying reserved, sent as a favorite or not at all", () => {
    const sentAsFavorite = entry("m1", "reserved", "manual");
    const notSent = entry("m2", "reserved", "manual");
    const plan = planSync([sentAsFavorite, notSent], sent({ favorites: ["m1"] }));
    expect(plan.update).toEqual([
      { ...sentAsFavorite, intent: "interested" },
      { ...notSent, intent: "interested" },
    ]);
    expect(plan.remove).toEqual([]);
  });

  it("a manual entry already reserved and sent as reserved is unchanged", () => {
    const manual = entry("m", "reserved", "manual");
    expect(planSync([manual], sent({ reserved: ["m"] })).unchanged).toEqual([manual]);
  });

  it("never duplicates: a session already on the plan, manual or synced, is not added again", () => {
    const plan = planSync([entry("m", "interested", "manual"), entry("s", "interested")], sent({ favorites: ["m", "s"] }));
    expect(plan.add).toEqual([]);
  });

  it("sending nothing removes every agent-sync entry and only those", () => {
    const synced = entry("s", "reserved");
    const plan = planSync([synced, entry("m", "interested", "manual")], sent({}));
    expect(plan.remove).toEqual([synced]);
    expect(plan.unchanged).toEqual([]);
  });

  it("applying the plan and syncing again is a no-op", () => {
    const lists = sent({ favorites: ["a", "b"], reserved: ["b", "c"], invited: ["d"] });
    const first = planSync([entry("a", "reserved"), entry("z", "interested"), entry("m", "reserved", "manual")], lists);
    const after = [
      ...first.unchanged,
      ...first.update,
      ...first.add.map((a) => entry(a.sessionId, a.intent, "agent-sync", { invited: a.invited })),
    ];
    const second = planSync(after, lists);
    expect(second.add).toEqual([]);
    expect(second.remove).toEqual([]);
    expect(second.update).toEqual([]);
    expect(second.unchanged).toHaveLength(4);
  });
});
