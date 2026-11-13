// "Same time as SVS401": two of my entries overlap. Worked out here from my
// own schedule's times, not asked of the server (issue #17): it is a fact
// about one list the screen already holds.
//
// Hidden entries count, because hiding a session from others does not free
// me to be elsewhere. All-day sessions (the expo and the like) never clash,
// for the reason they never block a meeting gap (domain.md, FindMeetingGaps).
import type { PlanEntry } from "@hallway/contracts";

/** For each entry that overlaps another, the names (code, else title) of the ones it overlaps. */
export function clashes(entries: readonly PlanEntry[]): Map<string, string[]> {
  const timed = entries.flatMap(({ session }) =>
    session.startsAt && session.endsAt && !session.isAllDay
      ? [{ id: session.sessionId, name: session.code ?? session.title ?? session.sessionId, start: Date.parse(session.startsAt), end: Date.parse(session.endsAt) }]
      : [],
  );
  const found = new Map<string, string[]>();
  for (const a of timed) {
    const others = timed.filter((b) => b.id !== a.id && a.start < b.end && b.start < a.end).map((b) => b.name);
    if (others.length > 0) found.set(a.id, others);
  }
  return found;
}

/** "Same time as SVS401", "Same time as SVS401 and DAT302", "Same time as A, B and C". */
export function clashLabel(names: readonly string[]): string {
  const list = names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
  return `Same time as ${list}`;
}
