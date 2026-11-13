import type { Intent, PlanEntry } from "./types";

/** What an agent's sync says about the attendee's AWS schedule, as session ids. */
export interface SyncInput {
  favorites: readonly string[];
  reserved: readonly string[];
  /** AWS `invitedSessions`: placed on the schedule by the event, so held like a reservation. */
  invited: readonly string[];
}

/** One session as the sync left it on the schedule. */
export interface SyncedSession {
  sessionId: string;
  intent: Intent;
  invited: boolean;
}

/**
 * The attendee's own intent for a session they added by hand. AddToPlan
 * makes only `interested` entries, so this is the intent a `manual` entry
 * falls back to when no sync says it is reserved.
 */
export const manualIntent: Intent = "interested";

/**
 * Each sent session once, with what the sync says of it. A reservation is the
 * stronger fact, so a session in both lists is `reserved`; an invited session
 * is `reserved` and marked invited.
 */
export function syncedSessions(sent: SyncInput): SyncedSession[] {
  const synced = new Map<string, SyncedSession>();
  for (const sessionId of sent.favorites) synced.set(sessionId, { sessionId, intent: "interested", invited: false });
  for (const sessionId of sent.reserved) synced.set(sessionId, { sessionId, intent: "reserved", invited: false });
  for (const sessionId of sent.invited) synced.set(sessionId, { sessionId, intent: "reserved", invited: true });
  return [...synced.values()];
}

/**
 * What a `manual` entry is after a sync that said `synced` of its session
 * (undefined: the sync did not send it). Its intent is `reserved` while the
 * latest sync reports it reserved, and otherwise the attendee's own.
 */
export function manualAfterSync(synced: SyncedSession | undefined): Pick<PlanEntry, "intent" | "invited"> {
  return synced?.intent === "reserved"
    ? { intent: "reserved", invited: synced.invited }
    : { intent: manualIntent, invited: false };
}

export interface SyncPlan {
  /** Sessions to add as new `agent-sync` entries. */
  add: SyncedSession[];
  /** `agent-sync` entries whose session the agent no longer sent. */
  remove: PlanEntry[];
  /** Entries whose intent or invited mark changed, already carrying the new ones. */
  update: PlanEntry[];
  /** Sent sessions already on the plan as they should be, `manual` ones included. */
  unchanged: PlanEntry[];
}

/**
 * What `SyncSchedule` does to one attendee's entries for one event so that
 * their `agent-sync` entries equal what the agent sent (domain.md "Sync
 * replaces, never duplicates"). `existing` is all of that attendee's entries
 * for the event, one per session; `synced` is `syncedSessions` of the sync.
 *
 * - Only `agent-sync` entries are added or removed. A `manual` entry is the
 *   attendee's own: a sync never removes it and never adds a second entry
 *   beside it, and sets its intent by `manualAfterSync`.
 * - An updated entry keeps its `source`, its `addedAt` and its hidden state.
 *
 * The handler uses the plan for its counts; the repository writes the same
 * outcome from `synced` alone, so a sync racing another write still ends as
 * exactly what one of them sent (ADR 0016).
 */
export function planSync(existing: readonly PlanEntry[], synced: readonly SyncedSession[]): SyncPlan {
  const wanted = new Map(synced.map((session) => [session.sessionId, session] as const));
  const plan: SyncPlan = { add: [], remove: [], update: [], unchanged: [] };
  const onPlan = new Set<string>();

  for (const entry of existing) {
    onPlan.add(entry.sessionId);
    const sent = wanted.get(entry.sessionId);
    if (entry.source === "agent-sync" && sent === undefined) {
      plan.remove.push(entry);
      continue;
    }
    const after = entry.source === "manual" ? manualAfterSync(sent) : { intent: sent!.intent, invited: sent!.invited };
    if (after.intent !== entry.intent || after.invited !== entry.invited) plan.update.push({ ...entry, ...after });
    else if (sent !== undefined) plan.unchanged.push(entry);
  }

  for (const session of synced) {
    if (!onPlan.has(session.sessionId)) plan.add.push(session);
  }
  return plan;
}
