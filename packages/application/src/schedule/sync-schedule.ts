// SyncSchedule (domain.md): the attendee's agent sends its AWS session
// snapshots and the favorites, reserved and invited lists; each snapshot of a
// listed session becomes this attendee's report of it, and the attendee's
// `agent-sync` entries become exactly the lists.
// `PUT /api/events/{eventId}/my-schedule` and the `sync_my_schedule` tool both
// call this.
import type { AwsSession as AwsSessionInput, SyncResult, SyncScheduleInput } from "@hallway/contracts";
import {
  mergeSnapshot,
  planSync,
  syncedSessions,
  toSession,
  unreadableTime,
  type AwsSession,
  type SessionReport,
} from "@hallway/domain";
import type { Actor } from "../actor.ts";
import { noEvent } from "../events/get-event.ts";
import { fail, ok, type Outcome } from "../outcome.ts";
import type { ScheduleDependencies } from "./dependencies.ts";
import { attendeeOf, signInFirst } from "./resources.ts";

export type SyncSchedule = (actor: Actor, input: SyncScheduleInput) => Promise<Outcome<SyncResult>>;

export function syncSchedule({ events, schedule, now }: ScheduleDependencies): SyncSchedule {
  return async (actor, input) => {
    const attendeeId = attendeeOf(actor);
    if (!attendeeId) return signInFirst();
    const event = await events.get(input.eventId);
    if (!event) return noEvent(input.eventId);
    const at = now().toISOString();

    const invited = input.invitedSessions.map((aws) => aws.sessionId);
    const listed = new Set([...input.favorites, ...input.reserved, ...invited]);
    // Only a session on this attendee's own AWS schedule is theirs to report
    // (ADR 0016): a snapshot of anything else is dropped unread, so no agent
    // can rewrite a session it does not hold. The last snapshot of a session
    // wins when an agent sends one twice.
    const kept = [...input.sessions, ...input.invitedSessions]
      .filter((aws) => listed.has(aws.sessionId))
      .map(asDomainSession);
    const snapshots = new Map(kept.map((aws) => [aws.sessionId, toSession(aws, event)] as const));
    // A time that does not read is kept as no time, and said (hunt F2): the
    // agent can tell the user, or send AWS's own values, rather than report a
    // session placed that is not.
    const unreadableTimes = [
      ...new Map(kept.map((aws) => [aws.sessionId, unreadableTime(aws)] as const)).entries(),
    ].flatMap(([sessionId, unreadable]) => (unreadable ? [{ sessionId, ...unreadable }] : []));
    const known = new Set(
      (await schedule.sessions(event.eventId, [...listed])).map((session) => session.sessionId),
    );
    const previous = new Map(
      (await schedule.reports(attendeeId, event.eventId, [...snapshots.keys()])).map(
        (report) => [report.sessionId, report] as const,
      ),
    );
    const reports: SessionReport[] = [...snapshots.values()].map((snapshot) => {
      const old = previous.get(snapshot.sessionId);
      return { ...(old ? mergeSnapshot(old, snapshot) : snapshot), attendeeId, reportedAt: at };
    });

    // An id with no snapshot is kept when the catalog already has the session
    // (another sync, or another attendee's, sent it); otherwise it is skipped
    // and reported, so one skipped GetSession does not fail the whole sync.
    const inCatalog = (id: string) => snapshots.has(id) || known.has(id);
    const missingSessions = [...listed].filter((id) => !inCatalog(id));
    const synced = syncedSessions({
      favorites: input.favorites.filter(inCatalog),
      reserved: input.reserved.filter(inCatalog),
      invited,
    });

    // The counts come from what was read; the write does not (ADR 0016).
    const plan = planSync(await schedule.entries(attendeeId, event.eventId), synced);
    const counts = {
      added: plan.add.length,
      removed: plan.remove.length,
      changed: plan.update.length,
      unchanged: plan.unchanged.length,
    };
    await schedule.applySync({
      attendeeId,
      eventId: event.eventId,
      reports,
      synced,
      at,
      lastSync: { syncedAt: at, ...counts, missingSessions: missingSessions.length },
    });

    return ok({ ...counts, sessionsStored: reports.length, missingSessions, unreadableTimes });
  };
}

// The contract's parsed value is the domain's AwsSession at runtime, but for
// `undefined` where the agent sent null (the contract reads null as absent),
// which every reader of AwsSession treats as absent; the types differ only by
// the `| undefined` that exactOptionalPropertyTypes adds to zod's optional fields.
// The fields toSession does not read (AWS's live seat state) are carried
// into it and ignored there; it copies only the fields Hallway keeps.
const asDomainSession = (aws: AwsSessionInput) => aws as AwsSession;
