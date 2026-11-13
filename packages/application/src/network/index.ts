// Every network handler, built over one set of ports. apps/api keeps them as
// one entry (`handlers.network`), as it does identity's.
import type { EventRepository } from "../events/event-repository.ts";
import type { AttendeeRepository, TieBetween } from "../identity/ports.ts";
import type { ScheduleRepository } from "../schedule/schedule-repository.ts";
import {
  connectViaShareLink,
  decideOn,
  listConnections,
  listRequests,
  removeConnection,
  requestConnection,
  type ConnectViaShareLink,
  type DecideRequest,
  type ListConnections,
  type ListRequests,
  type RemoveConnection,
  type RequestConnection,
} from "./connections.ts";
import { importContacts, listSuggestions, type ImportContacts, type ListSuggestions } from "./contacts.ts";
import { listFollowing, listMyNetwork, type ListFollowing, type ListMyNetwork } from "./following.ts";
import { getInvite, rotateInvite, type GetInvite, type RotateInvite } from "./invites.ts";
import type { NetworkRepository } from "./ports.ts";
import {
  findMeetingGaps,
  getAttendeeSchedule,
  networkAgenda,
  whoIsGoing,
  type FindMeetingGaps,
  type GetAttendeeSchedule,
  type GetNetworkAgenda,
  type WhoIsGoingQuery,
} from "./schedules.ts";

export type {
  ConnectionRequestRecord,
  ContactImportRecord,
  InviteRecord,
  NetworkMemberRecord,
  NetworkPlan,
  NetworkRepository,
  PlanScope,
} from "./ports.ts";
export { connectionsGoing } from "./schedules.ts";
export { recordGitHubFollowing } from "./following.ts";
export { invitePathOf } from "./invites.ts";

export interface NetworkPorts {
  attendees: AttendeeRepository;
  network: NetworkRepository;
  events: EventRepository;
  schedule: ScheduleRepository;
  /** The one lookup every read path hands the visibility rule (apps/api's composition root). */
  tieBetween: TieBetween;
  sessionUrlTemplate: string;
  now?: () => Date;
}

export interface NetworkHandlers {
  requestConnection: RequestConnection;
  withdrawRequest: DecideRequest;
  acceptRequest: DecideRequest;
  declineRequest: DecideRequest;
  connectViaShareLink: ConnectViaShareLink;
  getInvite: GetInvite;
  rotateInvite: RotateInvite;
  removeConnection: RemoveConnection;
  listConnections: ListConnections;
  listRequests: ListRequests;
  importContacts: ImportContacts;
  listSuggestions: ListSuggestions;
  listMyNetwork: ListMyNetwork;
  listFollowing: ListFollowing;
  getAttendeeSchedule: GetAttendeeSchedule;
  whoIsGoing: WhoIsGoingQuery;
  networkAgenda: GetNetworkAgenda;
  findMeetingGaps: FindMeetingGaps;
}

export function networkHandlers(ports: NetworkPorts): NetworkHandlers {
  const now = ports.now ?? (() => new Date());
  const writes = { attendees: ports.attendees, network: ports.network, now };
  const network = { attendees: ports.attendees, network: ports.network, events: ports.events, schedule: ports.schedule };
  return {
    requestConnection: requestConnection(writes),
    withdrawRequest: decideOn(writes, "withdraw"),
    acceptRequest: decideOn(writes, "accept"),
    declineRequest: decideOn(writes, "decline"),
    connectViaShareLink: connectViaShareLink(writes),
    getInvite: getInvite(writes),
    rotateInvite: rotateInvite(writes),
    removeConnection: removeConnection(writes),
    listConnections: listConnections({ ...writes, events: ports.events, schedule: ports.schedule }),
    listRequests: listRequests(writes),
    importContacts: importContacts(writes),
    listSuggestions: listSuggestions(writes),
    listMyNetwork: listMyNetwork(network),
    listFollowing: listFollowing(network),
    getAttendeeSchedule: getAttendeeSchedule(ports),
    whoIsGoing: whoIsGoing(ports),
    networkAgenda: networkAgenda(ports),
    findMeetingGaps: findMeetingGaps(ports),
  };
}
