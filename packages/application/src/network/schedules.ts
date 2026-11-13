// The reads of other people's schedules (domain.md): GetAttendeeSchedule,
// WhoIsGoing, NetworkAgenda, FindMeetingGaps, and the "connections going"
// that session search and get carry.
//
// Every one of them filters entries through the domain's `visibleEntries` and
// nothing else, so the visibility rule and the hidden flag hold on each path
// without a second copy of either.
import type {
  GetPersonScheduleInput,
  MeetingGaps,
  MeetingGapsInput,
  NetworkAgenda,
  NetworkAgendaInput,
  Person,
  PersonSchedule,
  WhoIsGoing,
  WhoIsGoingInput,
} from "@hallway/contracts";
import { canViewSchedule, findGaps, localWindow, normalizeHandle, visibleEntries } from "@hallway/domain";
import type { Actor } from "../actor.ts";
import type { EventRepository } from "../events/event-repository.ts";
import type { AreConnected, AttendeeRepository } from "../identity/ports.ts";
import { signedInAttendee } from "../identity/profile.ts";
import { toCard } from "../identity/views.ts";
import { fail, ok, type Outcome } from "../outcome.ts";
import type { ConnectionsGoingLookup } from "../schedule/dependencies.ts";
import { sessionResource } from "../schedule/resources.ts";
import type { CatalogSession, ScheduleRepository } from "../schedule/schedule-repository.ts";
import type { NetworkRepository, PlanScope } from "./ports.ts";
import { byName, toPerson } from "./views.ts";

export type GetAttendeeSchedule = (actor: Actor, input: GetPersonScheduleInput) => Promise<Outcome<PersonSchedule>>;
export type WhoIsGoingQuery = (actor: Actor, input: WhoIsGoingInput) => Promise<Outcome<WhoIsGoing>>;
export type GetNetworkAgenda = (actor: Actor, input: NetworkAgendaInput) => Promise<Outcome<NetworkAgenda>>;
export type FindMeetingGaps = (actor: Actor, input: MeetingGapsInput) => Promise<Outcome<MeetingGaps>>;

export interface NetworkReadPorts {
  attendees: AttendeeRepository;
  network: NetworkRepository;
  events: EventRepository;
  schedule: ScheduleRepository;
  areConnected: AreConnected;
  sessionUrlTemplate: string;
}

const notVisible = (handle: string) =>
  fail<never>("forbidden", `@${handle}'s schedule is not visible to you: it is private, or for their connections only.`);

/**
 * Per session, my connections going whose entry I may see: one read of all
 * their entries for the sessions in view, then `visibleEntries` per owner.
 * The read is joined through my connections, so `areConnected` is true here.
 */
async function goingAmongConnections(
  network: NetworkRepository,
  viewerId: string,
  eventId: string,
  scope: PlanScope,
): Promise<Map<string, { session: CatalogSession; people: Person[] }>> {
  const plans = await network.connectionPlans(viewerId, eventId, scope);
  const byOwner = new Map<string, typeof plans>();
  for (const plan of plans) {
    const owned = byOwner.get(plan.owner.id);
    if (owned) owned.push(plan);
    else byOwner.set(plan.owner.id, [plan]);
  }
  const going = new Map<string, { session: CatalogSession; people: Person[] }>();
  for (const ownerPlans of byOwner.values()) {
    const owner = ownerPlans[0]!.owner;
    const visible = new Set(
      visibleEntries(viewerId, owner, ownerPlans.map((plan) => plan.entry), true).map((entry) => entry.sessionId),
    );
    for (const { entry, session } of ownerPlans) {
      if (!visible.has(entry.sessionId)) continue;
      const slot = going.get(entry.sessionId) ?? { session, people: [] };
      slot.people.push(toPerson(owner));
      going.set(entry.sessionId, slot);
    }
  }
  for (const slot of going.values()) slot.people.sort(byName);
  return going;
}

/** What session search and get ask: nobody for an anonymous asker, who has no connections. */
export function connectionsGoing(network: NetworkRepository): ConnectionsGoingLookup {
  return async (actor, eventId, sessionIds) => {
    if (actor.kind !== "attendee" || sessionIds.length === 0) return undefined;
    const going = await goingAmongConnections(network, actor.attendeeId, eventId, { sessionIds });
    return new Map([...going].map(([sessionId, { people }]) => [sessionId, people]));
  };
}

export function getAttendeeSchedule(ports: NetworkReadPorts): GetAttendeeSchedule {
  return async (actor, { handle: rawHandle, eventId }) => {
    const handle = normalizeHandle(rawHandle);
    const owner = await ports.attendees.byHandle(handle);
    if (!owner) return fail("not-found", `No attendee @${handle}.`);
    const event = await ports.events.get(eventId);
    if (!event) return fail("not-found", `No event ${eventId}.`);
    const viewer = actor.kind === "attendee" ? actor.attendeeId : null;
    const connected = viewer !== null && viewer !== owner.id && (await ports.areConnected(viewer, owner.id));
    if (!canViewSchedule(viewer, owner, connected)) return notVisible(owner.handle);

    const scheduled = await ports.schedule.schedule(owner.id, eventId);
    const visible = new Set(
      visibleEntries(viewer, owner, scheduled.map(({ entry }) => entry), connected).map((entry) => entry.sessionId),
    );
    return ok({
      attendee: toCard(owner, true),
      eventId,
      timezone: event.timezone,
      entries: scheduled
        .filter(({ entry }) => visible.has(entry.sessionId))
        .map(({ entry, session }) => ({
          sessionId: entry.sessionId,
          intent: entry.intent,
          hidden: entry.hidden,
          session: sessionResource(session, ports.sessionUrlTemplate),
        })),
    });
  };
}

export function whoIsGoing({ attendees, network }: NetworkReadPorts): WhoIsGoingQuery {
  return async (actor, { eventId, sessionIds }) => {
    const me = await signedInAttendee(attendees, actor);
    if (!me.ok) return me;
    const asked = [...new Set(sessionIds)];
    const going = await goingAmongConnections(network, me.value.id, eventId, { sessionIds: asked });
    return ok({ sessions: asked.map((sessionId) => ({ sessionId, people: going.get(sessionId)?.people ?? [] })) });
  };
}

export function networkAgenda({ attendees, network, events, sessionUrlTemplate }: NetworkReadPorts): GetNetworkAgenda {
  return async (actor, { eventId, day, from = "00:00", to = "24:00" }) => {
    const me = await signedInAttendee(attendees, actor);
    if (!me.ok) return me;
    const event = await events.get(eventId);
    if (!event) return fail("not-found", `No event ${eventId}.`);
    const window = localWindow(day, from, to, event.timezone);
    if (!window) return fail("invalid", `${day} ${from} to ${to} is not a window of time.`);

    const going = await goingAmongConnections(network, me.value.id, eventId, {
      startsFrom: window.from,
      startsBefore: window.to,
    });
    const items = [...going.values()]
      .sort((a, b) => sessionOrder(a.session, b.session))
      .map(({ session, people }) => ({ session: sessionResource(session, sessionUrlTemplate), people }));
    return ok({ eventId, timezone: event.timezone, from: window.from, to: window.to, items });
  };
}

/**
 * Gaps when neither of us has a session: all of mine (a hidden entry is still
 * somewhere I will be), and of theirs only what I may see.
 */
export function findMeetingGaps(ports: NetworkReadPorts): FindMeetingGaps {
  return async (actor, { eventId, handle: rawHandle, day, from, to, minMinutes }) => {
    const me = await signedInAttendee(ports.attendees, actor);
    if (!me.ok) return me;
    const handle = normalizeHandle(rawHandle);
    const other = await ports.attendees.byHandle(handle);
    if (!other) return fail("not-found", `No attendee @${handle}.`);
    if (other.id === me.value.id) return fail("invalid", "Name someone else to meet.");
    const event = await ports.events.get(eventId);
    if (!event) return fail("not-found", `No event ${eventId}.`);
    if (!localWindow(day, from, to, event.timezone)) {
      return fail("invalid", `${day} ${from} to ${to} is not a window of time.`);
    }
    const connected = await ports.areConnected(me.value.id, other.id);
    if (!canViewSchedule(me.value.id, other, connected)) return notVisible(other.handle);

    const [mine, theirs] = await Promise.all([
      ports.schedule.schedule(me.value.id, eventId),
      ports.schedule.schedule(other.id, eventId),
    ]);
    const theirVisible = new Set(
      visibleEntries(me.value.id, other, theirs.map(({ entry }) => entry), connected).map((entry) => entry.sessionId),
    );
    const gaps = findGaps(
      mine.map(({ session }) => session),
      theirs.filter(({ entry }) => theirVisible.has(entry.sessionId)).map(({ session }) => session),
      day,
      from,
      to,
      minMinutes,
      event.timezone,
    );
    return ok({ with: toPerson(other), day, timezone: event.timezone, gaps });
  };
}

const compareText = (a: string | undefined, b: string | undefined) =>
  a === b ? 0 : a === undefined ? 1 : b === undefined ? -1 : a < b ? -1 : 1;

/** The order every session list keeps (ScheduleRepository): start, unplaced last, then code, then id. */
const sessionOrder = (a: CatalogSession, b: CatalogSession) =>
  compareText(a.startsAt, b.startsAt) || compareText(a.code, b.code) || compareText(a.sessionId, b.sessionId);
