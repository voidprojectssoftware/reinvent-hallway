// The schedule slice's MCP tools. Each calls the same handler as its REST
// route, with the same contract schema (ADR 0002).
import type { Actor } from "@hallway/application";
import {
  EventScope,
  MySchedule,
  PlanEntry,
  SearchSessionsInput,
  SessionList,
  SessionScope,
  SyncResult,
  SyncScheduleInput,
} from "@hallway/contracts";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Handlers } from "../app.ts";
import { toolResult } from "./outcome-mcp.ts";
import { asToolOutput } from "./server.ts";

/**
 * Product copy for agents: the one place an agent learns how to get its
 * attendee's schedule from AWS into Hallway.
 */
export const syncMyScheduleDescription = [
  "Put the user's AWS re:Invent 2026 schedule on Hallway, so the people they know can see where they will be. Hallway cannot read AWS itself; you read it from the AWS Events MCP server and send it here.",
  "1. Call the AWS Events MCP tool `GetSchedule` with eventId `reinvent2026`. It returns `favorites` and `reserved`, two lists of session ids, and `invitedSessions`, whole sessions the event placed on the user's schedule.",
  "2. Call AWS `GetSession` for each id in `favorites` and `reserved` (or, for many ids, page through AWS `ListSessions` with `includeAbstracts=false` and keep the ones you need).",
  "3. Call this tool once, with eventId `reinvent2026`, every session object in `sessions` exactly as AWS returned it, the two id lists exactly as `GetSchedule` gave them, and `invitedSessions` exactly as `GetSchedule` gave it.",
  "Leave `abstract` out of each session if you can: Hallway never stores or shows it, and dropping it keeps a large schedule within your tool-input limits. Sessions shaped like `ListSessions` with `includeAbstracts=false` are exactly right.",
  "Each call replaces what your last sync put on Hallway: un-favorited sessions are removed, reservations and invitations show as reserved (invitations marked `invited`), and sessions the user added or hid on Hallway are kept. The same input twice changes nothing. An id sent without a session object that Hallway has never seen is skipped and listed in `missingSessions`; call `GetSession` for those and sync again.",
  "Send only the user's own sessions, copied from AWS. A session object for an id in none of the lists is ignored. The session details everyone sees are what most attendees' agents report, so one agent's copying mistake does not change a session for others.",
  "Hallway never reserves, cancels or favorites anything on AWS, and writes nothing back to AWS. To reserve a seat, use AWS `ReserveSessions` or follow the session's `url`.",
].join("\n\n");

export function registerScheduleTools(server: McpServer, handlers: Handlers, actor: Actor) {
  server.registerTool(
    "sync_my_schedule",
    {
      title: "Sync my re:Invent schedule from AWS",
      description: syncMyScheduleDescription,
      inputSchema: SyncScheduleInput,
      outputSchema: asToolOutput(SyncResult),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    async (input) => toolResult(await handlers.syncSchedule(actor, input)),
  );

  server.registerTool(
    "get_my_schedule",
    {
      title: "Get my schedule",
      description:
        "The user's Hallway schedule for an event (`reinvent2026`), hidden entries included and marked. Times are UTC instants; show them in the returned `timezone` (Las Vegas time), the time on the badge.",
      inputSchema: EventScope,
      outputSchema: asToolOutput(MySchedule),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (input) => toolResult(await handlers.getMySchedule(actor, input)),
  );

  server.registerTool(
    "search_sessions",
    {
      title: "Search sessions",
      description:
        "Search Hallway's re:Invent session catalog (the sessions attendees' agents have synced, not all of AWS's) by text (`q`: code, title or speaker, ignoring case and accents) and by `day` in Las Vegas time (`2026-12-01`). Times are UTC instants. Each session's `url` opens it on the re:Invent site.",
      inputSchema: SearchSessionsInput,
      outputSchema: asToolOutput(SessionList),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (input) => toolResult(await handlers.searchSessions(actor, input)),
  );

  server.registerTool(
    "add_to_plan",
    {
      title: "Add a session to my schedule",
      description:
        "Add a session from Hallway's catalog to the user's Hallway schedule by hand, as `interested`. Adding one already there changes nothing. This does not favorite or reserve it on AWS.",
      inputSchema: SessionScope,
      outputSchema: asToolOutput(PlanEntry),
      annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (input) => toolResult(await handlers.addToPlan(actor, input)),
  );

  server.registerTool(
    "remove_from_plan",
    {
      title: "Remove a session I added by hand",
      description:
        "Remove a session the user added on Hallway by hand. A session that came from their AWS schedule is refused, because the next sync would bring it back: remove it on AWS and sync again instead.",
      inputSchema: SessionScope,
      outputSchema: asToolOutput(PlanEntry),
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    },
    async (input) => toolResult(await handlers.removeFromPlan(actor, input)),
  );
}
