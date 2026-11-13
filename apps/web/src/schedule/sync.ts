// The words for my agent's last sync (MySchedule.lastSync, #37), as
// connect-agent.html and my-week-share.html put them.
import type { LastSync } from "@hallway/contracts";

export const sessions = (n: number) => (n === 1 ? "1 session" : `${n} sessions`);

/** "3 added, 1 removed, 10 unchanged", with "changed" and "skipped" only when there were any. */
export function syncCounts(last: LastSync): string {
  const parts = [`${last.added} added`, `${last.removed} removed`];
  if (last.changed > 0) parts.push(`${last.changed} changed`);
  parts.push(`${last.unchanged} unchanged`);
  if (last.missingSessions > 0) parts.push(`${last.missingSessions} skipped without details`);
  return parts.join(", ");
}
