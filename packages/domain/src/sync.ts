import type { Intent, PlanEntry } from "./types";

export interface SyncInput {
  favorites: readonly string[];
  reserved: readonly string[];
}

export interface SyncPlan {
  /** Sessions to add as new `agent-sync` entries, not hidden. */
  add: { sessionId: string; intent: Intent }[];
  /** `agent-sync` entries whose session the agent no longer sent. */
  remove: PlanEntry[];
  /** `agent-sync` entries whose intent changed, already carrying the new intent. */
  update: PlanEntry[];
  /** Sent sessions already on the plan as they should be, `manual` ones included. */
  unchanged: PlanEntry[];
}

/**
 * What `SyncSchedule` must do to one attendee's entries for one event so that
 * their `agent-sync` entries equal what the agent sent (domain.md "Sync
 * replaces, never duplicates"). `existing` is all of that attendee's entries
 * for the event, one per session.
 *
 * - A session in both lists is `reserved`: a reservation is the stronger fact.
 * - Only `agent-sync` entries are added, removed or changed. A `manual` entry
 *   is the attendee's own and is left exactly as it is, even when the agent
 *   sends the same session; no second entry is added beside it.
 * - An updated entry keeps its `hidden` flag and `addedAt`.
 */
export function planSync(existing: readonly PlanEntry[], sent: SyncInput): SyncPlan {
  const wanted = new Map<string, Intent>();
  for (const id of sent.favorites) wanted.set(id, "interested");
  for (const id of sent.reserved) wanted.set(id, "reserved");

  const plan: SyncPlan = { add: [], remove: [], update: [], unchanged: [] };
  const onPlan = new Set<string>();

  for (const entry of existing) {
    onPlan.add(entry.sessionId);
    const intent = wanted.get(entry.sessionId);
    if (entry.source === "manual") {
      if (intent !== undefined) plan.unchanged.push(entry);
    } else if (intent === undefined) {
      plan.remove.push(entry);
    } else if (intent !== entry.intent) {
      plan.update.push({ ...entry, intent });
    } else {
      plan.unchanged.push(entry);
    }
  }

  for (const [sessionId, intent] of wanted) {
    if (!onPlan.has(sessionId)) plan.add.push({ sessionId, intent });
  }
  return plan;
}
