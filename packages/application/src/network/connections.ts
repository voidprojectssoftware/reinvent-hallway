// RequestConnection, WithdrawRequest, AcceptRequest, DeclineRequest,
// ConnectViaShareLink, RemoveConnection, ListConnections and ListRequests
// (domain.md). A connection is mutual: it forms only when the other side
// accepts, or at once through their share link.
import type {
  Connection as ConnectionResource,
  ConnectionList,
  ConnectionRequest as ConnectionRequestResource,
  ConnectInput,
  ListConnectionsInput,
  PersonScope,
  RequestConnectionInput,
  RequestList,
  RequestResult,
  RequestScope,
} from "@hallway/contracts";
import { connectionBetween, decideRequest, normalizeHandle, type RequestDecision } from "@hallway/domain";
import type { Actor } from "../actor.ts";
import type { EventRepository } from "../events/event-repository.ts";
import type { AttendeeRecord, AttendeeRepository } from "../identity/ports.ts";
import { signedInAttendee } from "../identity/profile.ts";
import { fail, ok, type Outcome } from "../outcome.ts";
import type { ScheduleRepository } from "../schedule/schedule-repository.ts";
import { isCurrentInvite } from "./invites.ts";
import type { ConnectionRequestRecord, NetworkRepository } from "./ports.ts";
import { networkSessionCounts } from "./schedules.ts";
import { byName, connectionResource, requestResource } from "./views.ts";

export type RequestConnection = (actor: Actor, input: RequestConnectionInput) => Promise<Outcome<RequestResult>>;
export type DecideRequest = (actor: Actor, input: RequestScope) => Promise<Outcome<RequestResult>>;
export type ConnectViaShareLink = (actor: Actor, input: ConnectInput) => Promise<Outcome<ConnectionResource>>;
export type RemoveConnection = (actor: Actor, input: PersonScope) => Promise<Outcome<ConnectionResource>>;
export type ListConnections = (actor: Actor, input?: ListConnectionsInput) => Promise<Outcome<ConnectionList>>;
export type ListRequests = (actor: Actor) => Promise<Outcome<RequestList>>;

export interface ConnectionPorts {
  attendees: AttendeeRepository;
  network: NetworkRepository;
  now: () => Date;
}

/** The attendee behind a handle, other than me. */
async function someoneElse(
  attendees: AttendeeRepository,
  me: AttendeeRecord,
  rawHandle: string,
): Promise<Outcome<AttendeeRecord>> {
  const handle = normalizeHandle(rawHandle);
  const other = await attendees.byHandle(handle);
  if (!other) return fail("not-found", `No attendee @${handle}.`);
  if (other.id === me.id) return fail("invalid", "That is you.");
  return ok(other);
}

/**
 * Asks to connect. Asking someone who has already asked me accepts their
 * request instead, so two requests that meet become one connection. Asking
 * again while my request is pending returns it unchanged.
 */
export function requestConnection({ attendees, network, now }: ConnectionPorts): RequestConnection {
  return async (actor, { handle }) => {
    const me = await signedInAttendee(attendees, actor);
    if (!me.ok) return me;
    const other = await someoneElse(attendees, me.value, handle);
    if (!other.ok) return other;
    const [from, to] = [me.value, other.value];
    if (await network.areConnected(from.id, to.id)) {
      return fail("conflict", `You are already connected to @${to.handle}.`);
    }

    const theirs = await network.pendingRequest(to.id, from.id);
    if (theirs) return decide({ attendees, network, now }, from.id, theirs, "accept");

    const mine = await network.pendingRequest(from.id, to.id);
    if (mine) return ok({ request: requestResource(mine, from, to) });
    const request: ConnectionRequestRecord = {
      id: crypto.randomUUID(),
      from: from.id,
      to: to.id,
      status: "pending",
      createdAt: now().toISOString(),
    };
    await network.createRequest(request);
    return ok({ request: requestResource(request, from, to) });
  };
}

/** Accept, decline or withdraw one request, by the domain's `decideRequest`. */
export function decideOn(ports: ConnectionPorts, decision: RequestDecision): DecideRequest {
  return async (actor, { requestId }) => {
    const me = await signedInAttendee(ports.attendees, actor);
    if (!me.ok) return me;
    const request = await ports.network.request(requestId);
    // Someone else's request is as absent to me as one that does not exist.
    if (!request || (request.from !== me.value.id && request.to !== me.value.id)) {
      return fail("not-found", `No request ${requestId}.`);
    }
    return decide(ports, me.value.id, request, decision);
  };
}

async function decide(
  { attendees, network, now }: ConnectionPorts,
  actorId: string,
  request: ConnectionRequestRecord,
  decision: RequestDecision,
): Promise<Outcome<RequestResult>> {
  const at = now().toISOString();
  const outcome = decideRequest(request, actorId, decision, at);
  if (!outcome.ok) {
    return outcome.error === "not-pending"
      ? fail("conflict", `That request is already ${request.status}.`)
      : fail("forbidden", decision === "withdraw" ? "Only its sender can withdraw a request." : "Only its recipient can answer a request.");
  }
  if (outcome.connection) await network.connect(outcome.connection, at);
  else await network.closeRequest(request.id, decision === "decline" ? "declined" : "withdrawn", at);

  const [from, to] = await Promise.all([attendees.byId(request.from), attendees.byId(request.to)]);
  if (!from || !to) return fail("not-found", "One side of that request no longer exists.");
  const decided = { ...request, status: outcome.request.status };
  const other = actorId === from.id ? to : from;
  return ok({
    request: requestResource(decided, from, to),
    ...(outcome.connection ? { connection: connectionResource(outcome.connection, other) } : {}),
  });
}

/**
 * The invite token in the owner's share link is their consent and the click
 * is mine (domain.md), so the connection forms at once. A handle alone is not
 * consent: without the owner's current token this refuses, and the viewer can
 * still ask with RequestConnection. Already connected returns the connection
 * as it is; any request pending between us is settled as accepted.
 */
export function connectViaShareLink({ attendees, network, now }: ConnectionPorts): ConnectViaShareLink {
  return async (actor, { handle, invite }) => {
    const me = await signedInAttendee(attendees, actor);
    if (!me.ok) return me;
    const owner = await someoneElse(attendees, me.value, handle);
    if (!owner.ok) return owner;
    if (!(await isCurrentInvite(network, owner.value.id, invite))) {
      return fail(
        "forbidden",
        `That is not @${owner.value.handle}'s current invite link. Ask them for it, or send a connection request.`,
      );
    }
    const existing = await network.connection(me.value.id, owner.value.id);
    if (existing) return ok(connectionResource(existing, owner.value));
    const at = now().toISOString();
    const connection = connectionBetween(me.value.id, owner.value.id, "share-link", at);
    await network.connect(connection, at);
    return ok(connectionResource(connection, owner.value));
  };
}

export function removeConnection({ attendees, network }: ConnectionPorts): RemoveConnection {
  return async (actor, { handle }) => {
    const me = await signedInAttendee(attendees, actor);
    if (!me.ok) return me;
    const other = await someoneElse(attendees, me.value, handle);
    if (!other.ok) return other;
    const connection = await network.connection(me.value.id, other.value.id);
    if (!connection) return fail("not-found", `You are not connected to @${other.value.handle}.`);
    await network.removeConnection(me.value.id, other.value.id);
    return ok(connectionResource(connection, other.value));
  };
}

export interface ListConnectionsPorts extends ConnectionPorts {
  events: EventRepository;
  schedule: ScheduleRepository;
}

/**
 * My connections. Asked for an event, each carries how many of their sessions
 * I may see and how many of those I share, counted through the same
 * visibility rule as every other read of their schedules (schedules.ts).
 */
export function listConnections({ attendees, network, events, schedule }: ListConnectionsPorts): ListConnections {
  return async (actor, { eventId } = {}) => {
    const me = await signedInAttendee(attendees, actor);
    if (!me.ok) return me;
    if (eventId !== undefined && !(await events.get(eventId))) return fail("not-found", `No event ${eventId}.`);
    const [connected, counts] = await Promise.all([
      network.connectionsOf(me.value.id),
      eventId === undefined ? undefined : networkSessionCounts(network, schedule, me.value.id, eventId),
    ]);
    const connections = connected.map(({ connection, other }) => ({
      ...connectionResource(connection, other),
      ...(counts ? (counts.get(other.id) ?? { sessions: 0, sharedWithMe: 0 }) : {}),
    }));
    return ok({ connections: connections.sort((a, b) => byName(a.person, b.person)) });
  };
}

export function listRequests({ attendees, network }: ConnectionPorts): ListRequests {
  return async (actor) => {
    const me = await signedInAttendee(attendees, actor);
    if (!me.ok) return me;
    const incoming: ConnectionRequestResource[] = [];
    const outgoing: ConnectionRequestResource[] = [];
    for (const { request, other } of await network.pendingRequestsOf(me.value.id)) {
      if (request.to === me.value.id) incoming.push(requestResource(request, other, me.value));
      else outgoing.push(requestResource(request, me.value, other));
    }
    return ok({ incoming, outgoing });
  };
}
