// The reads of other people's schedules (domain.md): GetAttendeeSchedule,
// WhoIsGoing, NetworkAgenda, FindMeetingGaps, the "connections going" that
// session search and get carry, and the session counts ListConnections and
// ListMyNetwork carry.
//
// Every one of them filters entries through the domain's `visibleEntries` and
// nothing else, with the tie from the one lookup (`tieBetween`, or the same
// tie read alongside the plans), so the visibility rule and the hidden flag
// hold on each path without a second copy of either.
import type {
  GetPersonScheduleInput,
  GoingPerson,
  MeetingGaps,
  MeetingGapsInput,
  NetworkAgenda,
  NetworkAgendaInput,
  PersonSchedule,
  WhoIsGoing,
  WhoIsGoingInput,
} from "@hallway/contracts";
import {
  canViewSchedule,
  eventDays,
  findGaps,
  isEventDay,
  localWindow,
  normalizeHandle,
  toLocal,
  unplacedInWindow,
  visibleEntries,
  type Attendee,
  type Event,
} from "@hallway/domain";
import type { Actor } from "../actor.ts";
import type { EventRepository } from "../events/event-repository.ts";
import { noEvent } from "../events/get-event.ts";
import type { AttendeeRepository, TieBetween } from "../identity/ports.ts";
import { signedInAttendee } from "../identity/profile.ts";
import { viewerTie } from "../identity/tie.ts";
import { toCard } from "../identity/views.ts";
import { fail, ok, type Outcome } from "../outcome.ts";
import type { ConnectionsGoingLookup } from "../schedule/dependencies.ts";
import { sessionResource } from "../schedule/resources.ts";
import type { CatalogSession, ScheduleRepository } from "../schedule/schedule-repository.ts";
import type { NetworkPlan, NetworkRepository, PlanScope } from "./ports.ts";
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
  tieBetween: TieBetween;
  sessionUrlTemplate: string;
}

/**
 * Why I may not see someone's schedule, said so the asker (often an agent)
 * knows what would change it: nothing for a private one, connecting for one
 * kept to their network (hunt F10). Following them does not change it
 * (ADR 0019), so that is said too.
 */
const notVisible = (owner: Pick<Attendee, "handle" | "visibility">) =>
  fail<never>(
    "forbidden",
    owner.visibility === "private"
      ? `@${owner.handle} keeps their schedule private: only they can see it, and connecting does not change that.`
      : `@${owner.handle} shares their schedule with their network only (their connections and the people they follow), and you are not in it. Following them does not change that. Connect on Hallway from their page (/@${owner.handle}) or their share link.`,
  );

/**
 * A day outside the event is refused rather than answered: a model that
 * reaches for last year's dates would otherwise tell the user that everyone
 * is free all day (hunt F9).
 */
const notAnEventDay = (day: string, event: Event) => {
  const { first, last } = eventDays(event);
  return fail<never>("invalid", `${day} is not a day of ${event.name}, which runs ${first} to ${last} (Las Vegas time).`);
};

/**
 * The plans of my network (connections and people I follow) that I may see:
 * one read of all their entries in scope, each with how I stand to its
 * owner, then `visibleEntries` per owner. Every count and every "going" here
 * comes from this, so a hidden entry, any entry of a private schedule, or a
 * network-only schedule of someone I follow who does not follow me back,
 * never lends anyone a session, an intent or a count.
 */
async function visibleNetworkPlans(
  network: NetworkRepository,
  viewerId: string,
  eventId: string,
  scope: PlanScope,
): Promise<NetworkPlan[]> {
  const plans = await network.networkPlans(viewerId, eventId, scope);
  const byOwner = new Map<string, NetworkPlan[]>();
  for (const plan of plans) {
    const owned = byOwner.get(plan.owner.id);
    if (owned) owned.push(plan);
    else byOwner.set(plan.owner.id, [plan]);
  }
  const visible: NetworkPlan[] = [];
  for (const ownerPlans of byOwner.values()) {
    const { owner, tie } = ownerPlans[0]!;
    const seen = new Set(
      visibleEntries(viewerId, owner, ownerPlans.map((plan) => plan.entry), tie).map((entry) => entry.sessionId),
    );
    visible.push(...ownerPlans.filter((plan) => seen.has(plan.entry.sessionId)));
  }
  return visible;
}

/** Per session, the people in my network going whose entry I may see, each with their intent. */
async function goingInNetwork(
  network: NetworkRepository,
  viewerId: string,
  eventId: string,
  scope: PlanScope,
): Promise<Map<string, { session: CatalogSession; people: GoingPerson[] }>> {
  const going = new Map<string, { session: CatalogSession; people: GoingPerson[] }>();
  for (const { owner, entry, session } of await visibleNetworkPlans(network, viewerId, eventId, scope)) {
    const slot = going.get(entry.sessionId) ?? { session, people: [] };
    slot.people.push({ ...toPerson(owner), intent: entry.intent });
    going.set(entry.sessionId, slot);
  }
  for (const slot of going.values()) slot.people.sort(byName);
  return going;
}

/** Per connection, at one event. */
export interface SessionCounts {
  /** Their sessions I may see. */
  sessions: number;
  /** Of those, the ones on my schedule too (every entry of mine, hidden ones included: I am going). */
  sharedWithMe: number;
}

/**
 * ListConnections' and ListMyNetwork's counts: two reads for my whole network (their entries,
 * my schedule), whatever its size. Someone I may see nothing of is
 * absent from the map; the caller counts them as zero.
 */
export async function networkSessionCounts(
  network: NetworkRepository,
  schedule: ScheduleRepository,
  viewerId: string,
  eventId: string,
): Promise<Map<string, SessionCounts>> {
  const [theirs, mine] = await Promise.all([
    visibleNetworkPlans(network, viewerId, eventId, { wholeEvent: true }),
    schedule.schedule(viewerId, eventId),
  ]);
  const myIds = new Set(mine.map(({ entry }) => entry.sessionId));
  const counts = new Map<string, SessionCounts>();
  for (const { owner, entry } of theirs) {
    const count = counts.get(owner.id) ?? { sessions: 0, sharedWithMe: 0 };
    count.sessions += 1;
    if (myIds.has(entry.sessionId)) count.sharedWithMe += 1;
    counts.set(owner.id, count);
  }
  return counts;
}

/** What session search and get ask: nobody for an anonymous asker, who has no connections. */
export function connectionsGoing(network: NetworkRepository): ConnectionsGoingLookup {
  return async (actor, eventId, sessionIds) => {
    if (actor.kind !== "attendee" || sessionIds.length === 0) return undefined;
    const going = await goingInNetwork(network, actor.attendeeId, eventId, { sessionIds });
    return new Map([...going].map(([sessionId, { people }]) => [sessionId, people]));
  };
}

export function getAttendeeSchedule(ports: NetworkReadPorts): GetAttendeeSchedule {
  return async (actor, { handle: rawHandle, eventId }) => {
    const handle = normalizeHandle(rawHandle);
    const owner = await ports.attendees.byHandle(handle);
    if (!owner) return fail("not-found", `No attendee @${handle}.`);
    const event = await ports.events.get(eventId);
    if (!event) return noEvent(eventId);
    const viewer = actor.kind === "attendee" ? actor.attendeeId : null;
    const tie = await viewerTie(ports.tieBetween, viewer, owner.id);
    if (!canViewSchedule(viewer, owner, tie)) return notVisible(owner);

    const scheduled = await ports.schedule.schedule(owner.id, eventId);
    const visible = new Set(
      visibleEntries(viewer, owner, scheduled.map(({ entry }) => entry), tie).map((entry) => entry.sessionId),
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

export function whoIsGoing({ attendees, network, schedule }: NetworkReadPorts): WhoIsGoingQuery {
  return async (actor, { eventId, sessionIds }) => {
    const me = await signedInAttendee(attendees, actor);
    if (!me.ok) return me;
    const asked = [...new Set(sessionIds)];
    const [going, known] = await Promise.all([
      goingInNetwork(network, me.value.id, eventId, { sessionIds: asked }),
      schedule.sessions(eventId, asked),
    ]);
    // "Nobody you know" and "no such session" read the same in `sessions`;
    // naming the second lets an agent fix an id or a code it passed (hunt F13).
    const inCatalog = new Set(known.map((session) => session.sessionId));
    const unknownSessions = asked.filter((sessionId) => !inCatalog.has(sessionId));
    return ok({
      sessions: asked.map((sessionId) => ({ sessionId, people: going.get(sessionId)?.people ?? [] })),
      ...(unknownSessions.length > 0 ? { unknownSessions } : {}),
    });
  };
}

export function networkAgenda({ attendees, network, events, sessionUrlTemplate }: NetworkReadPorts): GetNetworkAgenda {
  return async (actor, { eventId, day, from = "00:00", to = "24:00" }) => {
    const me = await signedInAttendee(attendees, actor);
    if (!me.ok) return me;
    const event = await events.get(eventId);
    if (!event) return noEvent(eventId);
    const window = localWindow(day, from, to, event.timezone);
    if (!window) return fail("invalid", `${day} ${from} to ${to} is not a window of time.`);
    if (!isEventDay(day, event)) return notAnEventDay(day, event);

    const going = await goingInNetwork(network, me.value.id, eventId, {
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
    if (!event) return noEvent(eventId);
    const window = localWindow(day, from, to, event.timezone);
    if (!window) return fail("invalid", `${day} ${from} to ${to} is not a window of time.`);
    if (!isEventDay(day, event)) return notAnEventDay(day, event);
    const tie = await ports.tieBetween(me.value.id, other.id);
    if (!canViewSchedule(me.value.id, other, tie)) return notVisible(other);

    const [mine, theirs] = await Promise.all([
      ports.schedule.schedule(me.value.id, eventId),
      ports.schedule.schedule(other.id, eventId),
    ]);
    const theirVisible = new Set(
      visibleEntries(me.value.id, other, theirs.map(({ entry }) => entry), tie).map((entry) => entry.sessionId),
    );
    const [mySessions, theirSessions] = [
      mine.map(({ session }) => session),
      theirs.filter(({ entry }) => theirVisible.has(entry.sessionId)).map(({ session }) => session),
    ];
    const gaps = findGaps(mySessions, theirSessions, day, from, to, minMinutes, event.timezone);
    const unplaced = (whose: "mine" | "theirs", sessions: CatalogSession[]) =>
      unplacedInWindow(sessions, window).map((session) => ({
        whose,
        sessionId: session.sessionId,
        ...(session.code === undefined ? {} : { code: session.code }),
        ...(session.title === undefined ? {} : { title: session.title }),
        startsAt: session.startsAt!,
        start: toLocal(session.startsAt!, event.timezone).time,
      }));
    return ok({
      with: toPerson(other),
      day,
      timezone: event.timezone,
      gaps,
      unplacedSessions: [...unplaced("mine", mySessions), ...unplaced("theirs", theirSessions)],
    });
  };
}

const compareText = (a: string | undefined, b: string | undefined) =>
  a === b ? 0 : a === undefined ? 1 : b === undefined ? -1 : a < b ? -1 : 1;

/** The order every session list keeps (ScheduleRepository): start, unplaced last, then code, then id. */
const sessionOrder = (a: CatalogSession, b: CatalogSession) =>
  compareText(a.startsAt, b.startsAt) || compareText(a.code, b.code) || compareText(a.sessionId, b.sessionId);
