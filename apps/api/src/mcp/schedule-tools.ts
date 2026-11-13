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
  SetEntryHiddenInput,
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
  "Hallway reads `sessionTime` as AWS gives it, in Las Vegas time: `date` as `YYYY-MM-DD`, `time` as 24-hour `HH:MM`, `length` as whole minutes. A session whose time does not read is kept without one and listed in `unreadableTimes`: re-send AWS's values unchanged, or tell the user which sessions show no time.",
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
    (input) => toolResult(() => handlers.syncSchedule(actor, input)),
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
    (input) => toolResult(() => handlers.getMySchedule(actor, input)),
  );

  server.registerTool(
    "search_sessions",
    {
      title: "Search sessions",
      description:
        "Search Hallway's re:Invent session catalog (the sessions attendees' agents have synced, not all of AWS's) by text (`q`: code, title or speaker, ignoring case and accents) and by `day` in Las Vegas time (`2026-12-01`). Returns at most `limit` sessions (default 50, up to 200); `total` is how many match and `truncated` is true when you saw only some, so narrow the search or raise `limit`. Times are UTC instants. Each session's `url` opens it on the re:Invent site.",
      inputSchema: SearchSessionsInput,
      outputSchema: asToolOutput(SessionList),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    (input) => toolResult(() => handlers.searchSessions(actor, input)),
  );

  server.registerTool(
    "add_to_plan",
    {
      title: "Add a session to my schedule",
      description:
        "Add a session from Hallway's catalog to the user's Hallway schedule by hand, as `interested`. `sessionId` takes AWS's session id or the session's code (`AIM3315`). Adding one already there changes nothing. This does not favorite or reserve it on AWS.",
      inputSchema: SessionScope,
      outputSchema: asToolOutput(PlanEntry),
      annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: false },
    },
    (input) => toolResult(() => handlers.addToPlan(actor, input)),
  );

  server.registerTool(
    "remove_from_plan",
    {
      title: "Remove a session I added by hand",
      description:
        "Remove a session the user added on Hallway by hand (by id or code). A session that came from their AWS schedule is refused, because the next sync would bring it back: hide it with set_entry_hidden, or remove it on AWS and sync again.",
      inputSchema: SessionScope,
      outputSchema: asToolOutput(PlanEntry),
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    },
    (input) => toolResult(() => handlers.removeFromPlan(actor, input)),
  );

  server.registerTool(
    "set_entry_hidden",
    {
      title: "Hide or show a session on my schedule",
      description:
        "Hide (`hidden: true`) or show again one session on the user's Hallway schedule, by id or code. A hidden session stays on the user's own schedule and still blocks their meeting gaps, but nobody else sees it, counts it or finds the user going to it, on Hallway, in shared links or in the calendar feed. Hiding outlasts syncs, even if the session leaves AWS and comes back. It changes nothing on AWS. Use it when the user wants a session kept to themselves, including one from AWS that remove_from_plan refuses.",
      inputSchema: SetEntryHiddenInput,
      outputSchema: asToolOutput(PlanEntry),
      annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: false },
    },
    (input) => toolResult(() => handlers.setEntryHidden(actor, input)),
  );
}
