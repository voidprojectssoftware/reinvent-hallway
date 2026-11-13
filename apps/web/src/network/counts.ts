// A connection's line under their name on Network (docs/design/network.html).
import type { Connection } from "@hallway/contracts";

/**
 * "9 sessions · 4 with you", from the counts ListConnections carries. A
 * schedule I may not see and one with nothing on it read the same, so the
 * line never tells which.
 */
export function sessionCounts({ sessions = 0, sharedWithMe = 0 }: Pick<Connection, "sessions" | "sharedWithMe">): string {
  if (sessions === 0) return "No sessions you can see";
  const all = `${sessions} ${sessions === 1 ? "session" : "sessions"}`;
  return sharedWithMe === 0 ? all : `${all} · ${sharedWithMe} with you`;
}
