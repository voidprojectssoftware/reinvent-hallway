// The network slice's MCP tools. Each calls the same handler as its REST
// route, with the same contract schema (ADR 0002). The descriptions are
// product copy for agents: they say when, in planning a day, to reach for
// each tool.
import type { Actor } from "@hallway/application";
import {
  ConnectionList,
  GetPersonScheduleInput,
  MeetingGaps,
  MeetingGapsInput,
  NetworkAgenda,
  NetworkAgendaInput,
  PersonSchedule,
  WhoIsGoing,
  WhoIsGoingInput,
} from "@hallway/contracts";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Handlers } from "../app.ts";
import { toolResult } from "./outcome-mcp.ts";
import { asToolOutput } from "./server.ts";

export const networkToolDescriptions = {
  list_my_connections: [
    "The people the user is connected to on Hallway: the people whose re:Invent plans the user can see.",
    "Call it first when the user talks about meeting, finding or following someone, to turn a name into a `handle` for the other tools. Only connections and people with public schedules can be planned around.",
  ].join(" "),
  get_person_schedule: [
    "One person's re:Invent schedule (by `handle`), as much of it as their visibility lets the user see, in start order. Times are UTC; show them in the returned `timezone` (Las Vegas time).",
    "Use it to plan around one person: to catch them between sessions, to join a session they are going to, or before suggesting a meeting. A refusal (`forbidden`) means their schedule is private or for their connections only; suggest the user connect with them on Hallway.",
  ].join(" "),
  who_is_going: [
    "For a list of session ids, which of the user's connections plan to attend each.",
    "Before choosing between two sessions in the same slot, ask who_is_going for both: a session a colleague is at is a chance to meet them. Pass every session you are weighing in one call (up to 200), not one call per session.",
  ].join(" "),
  network_agenda: [
    "What the user's connections plan to attend in a window of one day (`day`, and optionally `from` and `to`, Las Vegas time, HH:MM), with who is going to each.",
    "Start here when the user says something like \"I'm free Tuesday afternoon, what are my people going to?\": it lists the sessions, then use who_is_going or get_person_schedule to go deeper. Each session's `url` opens it on the re:Invent site, where the user reserves a seat.",
  ].join(" "),
  find_meeting_gaps: [
    "Free windows on one day when neither the user nor one other person (`handle`) has a session, between `from` and `to` (Las Vegas time, default 08:00 to 18:00), at least `minMinutes` long (default 30).",
    "Use it to suggest a time to meet someone in person. It counts all of the user's own sessions, and only what the other person lets the user see of theirs; all-day sessions such as the expo do not block a gap. It does not book anything or tell the other person.",
  ].join(" "),
} as const;

const readOnly = { readOnlyHint: true, openWorldHint: false } as const;

export function registerNetworkTools(server: McpServer, handlers: Handlers, actor: Actor) {
  server.registerTool(
    "list_my_connections",
    {
      title: "List my connections",
      description: networkToolDescriptions.list_my_connections,
      outputSchema: asToolOutput(ConnectionList),
      annotations: readOnly,
    },
    async () => toolResult(await handlers.network.listConnections(actor)),
  );

  server.registerTool(
    "get_person_schedule",
    {
      title: "Get a person's schedule",
      description: networkToolDescriptions.get_person_schedule,
      inputSchema: GetPersonScheduleInput,
      outputSchema: asToolOutput(PersonSchedule),
      annotations: readOnly,
    },
    async (input) => toolResult(await handlers.network.getAttendeeSchedule(actor, input)),
  );

  server.registerTool(
    "who_is_going",
    {
      title: "Who is going to these sessions",
      description: networkToolDescriptions.who_is_going,
      inputSchema: WhoIsGoingInput,
      outputSchema: asToolOutput(WhoIsGoing),
      annotations: readOnly,
    },
    async (input) => toolResult(await handlers.network.whoIsGoing(actor, input)),
  );

  server.registerTool(
    "network_agenda",
    {
      title: "What my connections are going to",
      description: networkToolDescriptions.network_agenda,
      inputSchema: NetworkAgendaInput,
      outputSchema: asToolOutput(NetworkAgenda),
      annotations: readOnly,
    },
    async (input) => toolResult(await handlers.network.networkAgenda(actor, input)),
  );

  server.registerTool(
    "find_meeting_gaps",
    {
      title: "Find a time to meet someone",
      description: networkToolDescriptions.find_meeting_gaps,
      inputSchema: MeetingGapsInput,
      outputSchema: asToolOutput(MeetingGaps),
      annotations: readOnly,
    },
    async (input) => toolResult(await handlers.network.findMeetingGaps(actor, input)),
  );
}
