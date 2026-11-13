// Every network handler, built over one set of ports. apps/api keeps them as
// one entry (`handlers.network`), as it does identity's.
import type { EventRepository } from "../events/event-repository.ts";
import type { AttendeeRepository } from "../identity/ports.ts";
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
  ConnectionPlan,
  ConnectionRequestRecord,
  ContactImportRecord,
  InviteRecord,
  NetworkRepository,
  PlanScope,
} from "./ports.ts";
export { connectionsGoing } from "./schedules.ts";
export { invitePathOf } from "./invites.ts";

export interface NetworkPorts {
  attendees: AttendeeRepository;
  network: NetworkRepository;
  events: EventRepository;
  schedule: ScheduleRepository;
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
  getAttendeeSchedule: GetAttendeeSchedule;
  whoIsGoing: WhoIsGoingQuery;
  networkAgenda: GetNetworkAgenda;
  findMeetingGaps: FindMeetingGaps;
}

export function networkHandlers(ports: NetworkPorts): NetworkHandlers {
  const now = ports.now ?? (() => new Date());
  const writes = { attendees: ports.attendees, network: ports.network, now };
  const reads = { ...ports, areConnected: (a: string, b: string) => ports.network.areConnected(a, b) };
  return {
    requestConnection: requestConnection(writes),
    withdrawRequest: decideOn(writes, "withdraw"),
    acceptRequest: decideOn(writes, "accept"),
    declineRequest: decideOn(writes, "decline"),
    connectViaShareLink: connectViaShareLink(writes),
    getInvite: getInvite(writes),
    rotateInvite: rotateInvite(writes),
    removeConnection: removeConnection(writes),
    listConnections: listConnections(writes),
    listRequests: listRequests(writes),
    importContacts: importContacts(writes),
    listSuggestions: listSuggestions(writes),
    getAttendeeSchedule: getAttendeeSchedule(reads),
    whoIsGoing: whoIsGoing(reads),
    networkAgenda: networkAgenda(reads),
    findMeetingGaps: findMeetingGaps(reads),
  };
}
