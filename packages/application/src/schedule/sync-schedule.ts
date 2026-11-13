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
  type AwsSession,
  type SessionReport,
} from "@hallway/domain";
import type { Actor } from "../actor.ts";
import { fail, ok, type Outcome } from "../outcome.ts";
import type { ScheduleDependencies } from "./dependencies.ts";
import { attendeeOf, signInFirst } from "./resources.ts";

export type SyncSchedule = (actor: Actor, input: SyncScheduleInput) => Promise<Outcome<SyncResult>>;

export function syncSchedule({ events, schedule, now }: ScheduleDependencies): SyncSchedule {
  return async (actor, input) => {
    const attendeeId = attendeeOf(actor);
    if (!attendeeId) return signInFirst();
    const event = await events.get(input.eventId);
    if (!event) return fail("not-found", `No event ${input.eventId}.`);
    const at = now().toISOString();

    const invited = input.invitedSessions.map((aws) => aws.sessionId);
    const listed = new Set([...input.favorites, ...input.reserved, ...invited]);
    // Only a session on this attendee's own AWS schedule is theirs to report
    // (ADR 0016): a snapshot of anything else is dropped unread, so no agent
    // can rewrite a session it does not hold. The last snapshot of a session
    // wins when an agent sends one twice.
    const snapshots = new Map(
      [...input.sessions, ...input.invitedSessions]
        .filter((aws) => listed.has(aws.sessionId))
        .map((aws) => [aws.sessionId, toSession(asDomainSession(aws), event)] as const),
    );
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

    return ok({ ...counts, sessionsStored: reports.length, missingSessions });
  };
}

// The contract's parsed value is the domain's AwsSession at runtime: zod drops
// absent keys rather than writing `undefined`, so the only difference is the
// `| undefined` that exactOptionalPropertyTypes adds to zod's optional fields.
// The fields toSession does not read (the abstract among them) are carried
// into it and ignored there; it copies only the fields Hallway keeps.
const asDomainSession = (aws: AwsSessionInput) => aws as AwsSession;
