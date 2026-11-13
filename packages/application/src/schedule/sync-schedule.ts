// SyncSchedule (domain.md): the attendee's agent sends its AWS session
// snapshots and the favorites and reserved id lists; the catalog takes the
// snapshots and the attendee's `agent-sync` entries become exactly the lists.
// `PUT /api/events/{eventId}/my-schedule` and the `sync_my_schedule` tool both
// call this.
import type { AwsSession as AwsSessionInput, SyncResult, SyncScheduleInput } from "@hallway/contracts";
import { mergeSnapshot, planSync, toSession, type AwsSession, type PlanEntry } from "@hallway/domain";
import type { Actor } from "../actor.ts";
import { fail, ok, type Outcome } from "../outcome.ts";
import type { ScheduleDependencies } from "./dependencies.ts";
import { attendeeOf, signInFirst } from "./resources.ts";
import type { CatalogSession } from "./schedule-repository.ts";

export type SyncSchedule = (actor: Actor, input: SyncScheduleInput) => Promise<Outcome<SyncResult>>;

export function syncSchedule({ events, schedule, now }: ScheduleDependencies): SyncSchedule {
  return async (actor, input) => {
    const attendeeId = attendeeOf(actor);
    if (!attendeeId) return signInFirst();
    const event = await events.get(input.eventId);
    if (!event) return fail("not-found", `No event ${input.eventId}.`);
    const at = now().toISOString();

    // The last snapshot of a session wins when an agent sends one twice.
    const snapshots = new Map(
      input.sessions.map((aws) => [aws.sessionId, toSession(asDomainSession(aws), event)] as const),
    );
    const listed = [...new Set([...input.favorites, ...input.reserved])];
    const known = new Map(
      (await schedule.sessions(event.eventId, [...new Set([...snapshots.keys(), ...listed])])).map(
        (session) => [session.sessionId, session] as const,
      ),
    );

    const stored: CatalogSession[] = [...snapshots.values()].map((snapshot) => {
      const old = known.get(snapshot.sessionId);
      return { ...(old ? mergeSnapshot(old, snapshot) : snapshot), lastSeenAt: at };
    });

    // An id with no snapshot is kept when the catalog already has the session
    // (another sync, or another attendee's, sent it); otherwise it is skipped
    // and reported, so one skipped GetSession does not fail the whole sync.
    const inCatalog = (id: string) => snapshots.has(id) || known.has(id);
    const missingSessions = listed.filter((id) => !inCatalog(id));
    const plan = planSync(await schedule.entries(attendeeId, event.eventId), {
      favorites: input.favorites.filter(inCatalog),
      reserved: input.reserved.filter(inCatalog),
    });

    const added: PlanEntry[] = plan.add.map(({ sessionId, intent }) => ({
      attendeeId,
      sessionId,
      intent,
      source: "agent-sync",
      hidden: false,
      addedAt: at,
    }));
    const counts = {
      added: added.length,
      removed: plan.remove.length,
      changed: plan.update.length,
      unchanged: plan.unchanged.length,
    };
    await schedule.applySync({
      attendeeId,
      eventId: event.eventId,
      sessions: stored,
      add: added,
      remove: plan.remove.map((entry) => entry.sessionId),
      update: plan.update,
      lastSync: { syncedAt: at, ...counts, missingSessions: missingSessions.length },
    });

    return ok({ ...counts, sessionsStored: stored.length, missingSessions });
  };
}

// The contract's parsed value is the domain's AwsSession at runtime: zod drops
// absent keys rather than writing `undefined`, so the only difference is the
// `| undefined` that exactOptionalPropertyTypes adds to zod's optional fields.
// The fields toSession does not read (the abstract among them) are carried
// into it and ignored there; it copies only the fields Hallway keeps.
const asDomainSession = (aws: AwsSessionInput) => aws as AwsSession;
