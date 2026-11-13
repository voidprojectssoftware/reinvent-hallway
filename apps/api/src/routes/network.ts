// The network routes: parse with the contract, call the handler, map the
// outcome. Nothing else belongs here (ADR 0002).
import { createRoute, z } from "@hono/zod-openapi";
import {
  ConnectBody,
  Connection,
  ConnectionList,
  ContactImport,
  EventScope,
  ImportContactsInput,
  Invite,
  maxContactsCsvBytes,
  MeetingGaps,
  MeetingGapsQuery,
  NetworkAgenda,
  NetworkAgendaQuery,
  PersonSchedule,
  PersonScheduleQuery,
  PersonScope,
  RequestConnectionInput,
  RequestList,
  RequestResult,
  RequestScope,
  SuggestionList,
  WhoIsGoing,
  WhoIsGoingQuery,
  type ApiError,
} from "@hallway/contracts";
import type { ApiApp } from "../app.ts";
import { errorResponses, refuse, respond } from "../outcome-http.ts";

const json = <T>(schema: T, description: string) => ({ description, content: { "application/json": { schema } } });
const tags = ["network"];

const listConnectionsRoute = createRoute({
  method: "get",
  path: "/api/me/connections",
  operationId: "listConnections",
  summary: "My connections",
  tags,
  responses: { 200: json(ConnectionList, "My connections, by name."), ...errorResponses },
});

const removeConnectionRoute = createRoute({
  method: "delete",
  path: "/api/me/connections/{handle}",
  operationId: "removeConnection",
  summary: "Stop being connected to someone. Either side may",
  tags,
  request: { params: PersonScope },
  responses: { 200: json(Connection, "The connection that was removed."), ...errorResponses },
});

const listRequestsRoute = createRoute({
  method: "get",
  path: "/api/me/connection-requests",
  operationId: "listConnectionRequests",
  summary: "My pending connection requests, to me and from me",
  tags,
  responses: { 200: json(RequestList, "Pending requests."), ...errorResponses },
});

const requestRoute = createRoute({
  method: "post",
  path: "/api/me/connection-requests",
  operationId: "requestConnection",
  summary: "Ask someone to connect",
  description:
    "If they have already asked me, this accepts their request and the response carries the connection. Asking again while my request is pending returns it unchanged.",
  tags,
  request: { body: { required: true, content: { "application/json": { schema: RequestConnectionInput } } } },
  responses: { 200: json(RequestResult, "The request, and the connection if one formed."), ...errorResponses },
});

const decisionRoute = (decision: "accept" | "decline", summary: string) =>
  createRoute({
    method: "post",
    path: `/api/me/connection-requests/{requestId}/${decision}`,
    operationId: `${decision}ConnectionRequest`,
    summary,
    tags,
    request: { params: RequestScope },
    responses: { 200: json(RequestResult, "The request as decided."), ...errorResponses },
  });
const acceptRoute = decisionRoute("accept", "Accept a request sent to me; we are connected");
const declineRoute = decisionRoute("decline", "Decline a request sent to me");

const withdrawRoute = createRoute({
  method: "delete",
  path: "/api/me/connection-requests/{requestId}",
  operationId: "withdrawConnectionRequest",
  summary: "Withdraw a request I sent",
  tags,
  request: { params: RequestScope },
  responses: { 200: json(RequestResult, "The request, withdrawn."), ...errorResponses },
});

const connectRoute = createRoute({
  method: "post",
  path: "/api/attendees/{handle}/connect",
  operationId: "connectViaShareLink",
  summary: "Connect at once from someone's share link (/@handle?invite=...)",
  description:
    "The link's invite token is their consent and this call is mine, so no request is needed. Without their current token: 403, and a connection request is the way to ask.",
  tags,
  // Not required: a call with no body has no invite, which is the 403 below, not a 400.
  request: { params: PersonScope, body: { required: false, content: { "application/json": { schema: ConnectBody } } } },
  responses: { 200: json(Connection, "The connection, new or existing."), ...errorResponses },
});

const getInviteRoute = createRoute({
  method: "get",
  path: "/api/me/invite",
  operationId: "getInvite",
  summary: "My share link, with its invite token. Web sign-in only: 403 to an agent token",
  tags,
  responses: { 200: json(Invite, "My invite, made on first ask."), ...errorResponses },
});

const rotateInviteRoute = createRoute({
  method: "post",
  path: "/api/me/invite/rotate",
  operationId: "rotateInvite",
  summary: "Replace my invite token: old links stop connecting, connections stay. Web sign-in only: 403 to an agent token",
  tags,
  responses: { 200: json(Invite, "The new invite."), ...errorResponses },
});

const importContactsRoute = createRoute({
  method: "post",
  path: "/api/me/contacts",
  operationId: "importContacts",
  summary: "Upload LinkedIn's Connections.csv, replacing my last upload",
  description: `The body is the file as LinkedIn's data export gave it (text/csv, up to ${maxContactsCsvBytes} bytes). Each row is reduced to a normalized profile URL, a normalized name and an email hash as it is read; nothing else from it is kept.`,
  tags,
  request: { body: { required: true, content: { "text/csv": { schema: z.string() } } } },
  responses: { 200: json(ContactImport, "What was kept."), ...errorResponses },
});

const suggestionsRoute = createRoute({
  method: "get",
  path: "/api/me/suggestions",
  operationId: "listSuggestions",
  summary: "Attendees from my LinkedIn connections I am not yet connected to",
  tags,
  responses: { 200: json(SuggestionList, "Suggestions, by name."), ...errorResponses },
});

const personScheduleRoute = createRoute({
  method: "get",
  path: "/api/attendees/{handle}/schedule",
  operationId: "getAttendeeSchedule",
  summary: "An attendee's schedule, as much of it as I may see",
  description: "403 when their visibility does not let me see it. Hidden entries appear only on my own.",
  tags,
  request: { params: PersonScope, query: PersonScheduleQuery },
  responses: { 200: json(PersonSchedule, "Their visible entries, in start order."), ...errorResponses },
});

const whoIsGoingRoute = createRoute({
  method: "get",
  path: "/api/events/{eventId}/who-is-going",
  operationId: "whoIsGoing",
  summary: "Per session, which of my connections are going",
  tags,
  request: { params: EventScope, query: WhoIsGoingQuery },
  responses: { 200: json(WhoIsGoing, "One row per session asked."), ...errorResponses },
});

const agendaRoute = createRoute({
  method: "get",
  path: "/api/events/{eventId}/network-agenda",
  operationId: "networkAgenda",
  summary: "Sessions my connections plan in a window of one day, with who",
  tags,
  request: { params: EventScope, query: NetworkAgendaQuery },
  responses: { 200: json(NetworkAgenda, "Sessions starting in the window."), ...errorResponses },
});

const gapsRoute = createRoute({
  method: "get",
  path: "/api/events/{eventId}/meeting-gaps",
  operationId: "findMeetingGaps",
  summary: "Free windows on a day for me and one other attendee",
  tags,
  request: { params: EventScope, query: MeetingGapsQuery },
  responses: { 200: json(MeetingGaps, "The gaps, in order."), ...errorResponses },
});

export function registerNetworkRoutes<B extends object>(app: ApiApp<B>) {
  app.openapi(listConnectionsRoute, async (c) => respond(c, await c.var.handlers.network.listConnections(c.var.actor)));
  app.openapi(removeConnectionRoute, async (c) =>
    respond(c, await c.var.handlers.network.removeConnection(c.var.actor, c.req.valid("param"))),
  );
  app.openapi(listRequestsRoute, async (c) => respond(c, await c.var.handlers.network.listRequests(c.var.actor)));
  app.openapi(requestRoute, async (c) =>
    respond(c, await c.var.handlers.network.requestConnection(c.var.actor, c.req.valid("json"))),
  );
  app.openapi(acceptRoute, async (c) => respond(c, await c.var.handlers.network.acceptRequest(c.var.actor, c.req.valid("param"))));
  app.openapi(declineRoute, async (c) =>
    respond(c, await c.var.handlers.network.declineRequest(c.var.actor, c.req.valid("param"))),
  );
  app.openapi(withdrawRoute, async (c) =>
    respond(c, await c.var.handlers.network.withdrawRequest(c.var.actor, c.req.valid("param"))),
  );
  app.openapi(connectRoute, async (c) =>
    respond(
      c,
      await c.var.handlers.network.connectViaShareLink(c.var.actor, {
        ...c.req.valid("param"),
        ...(c.req.valid("json") ?? {}),
      }),
    ),
  );
  app.openapi(getInviteRoute, async (c) => respond(c, await c.var.handlers.network.getInvite(c.var.actor)));
  app.openapi(rotateInviteRoute, async (c) => respond(c, await c.var.handlers.network.rotateInvite(c.var.actor)));
  app.openapi(importContactsRoute, async (c) => {
    // A CSV body is read as text here, then held to the contract like any other input.
    const input = ImportContactsInput.safeParse({ csv: await c.req.text() });
    if (!input.success) {
      const error: ApiError = { kind: "invalid", message: `Send the CSV as the body, at most ${maxContactsCsvBytes} bytes.` };
      return refuse(c, error);
    }
    return respond(c, await c.var.handlers.network.importContacts(c.var.actor, input.data));
  });
  app.openapi(suggestionsRoute, async (c) => respond(c, await c.var.handlers.network.listSuggestions(c.var.actor)));
  app.openapi(personScheduleRoute, async (c) =>
    respond(
      c,
      await c.var.handlers.network.getAttendeeSchedule(c.var.actor, { ...c.req.valid("param"), ...c.req.valid("query") }),
    ),
  );
  app.openapi(whoIsGoingRoute, async (c) =>
    respond(c, await c.var.handlers.network.whoIsGoing(c.var.actor, { ...c.req.valid("param"), ...c.req.valid("query") })),
  );
  app.openapi(agendaRoute, async (c) =>
    respond(c, await c.var.handlers.network.networkAgenda(c.var.actor, { ...c.req.valid("param"), ...c.req.valid("query") })),
  );
  app.openapi(gapsRoute, async (c) =>
    respond(c, await c.var.handlers.network.findMeetingGaps(c.var.actor, { ...c.req.valid("param"), ...c.req.valid("query") })),
  );
}
