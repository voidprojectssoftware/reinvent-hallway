// The schedule resources (docs/architecture/domain.md): Session, Plan entry,
// and what SyncSchedule takes and returns.
//
// The sync input accepts AWS's own `Session` shape (the AWS Events API spec,
// docs/discovery/aws-events-api/openapi-2026-11-13.json) so an agent can pass
// `GetSession` output straight through. `abstract` and the taxonomies other
// than `topics` are accepted so that pass-through validates, and are never
// read: packages/domain's `toSession` copies only the fields Hallway keeps
// (ADR 0003), and no resource below has an abstract to carry.
import { z } from "zod";
import { EventId } from "./event.ts";
import { Person } from "./identity.ts";

export const SessionId = z
  .string()
  .min(1)
  .max(128)
  .meta({ description: "AWS's session id, stable across requests." });

const taxonomy = z.array(z.string()).max(100).optional();

/** AWS's `Session`, as `GetSession` returns it or `ListSessions` lists it. */
export const AwsSession = z
  .object({
    sessionId: SessionId,
    title: z.string().optional(),
    abbreviation: z.string().optional().meta({ description: "The public session code, e.g. `AIM3315`." }),
    abstract: z
      .string()
      .optional()
      .meta({ description: "Accepted so AWS's shape passes through, then discarded. Leave it out to keep the call small." }),
    type: z.string().optional(),
    level: z.string().optional(),
    venue: z.string().optional(),
    room: z.string().optional(),
    isAllDaySession: z.boolean().optional(),
    isReservable: z.boolean().optional(),
    seatAvailability: z.string().optional(),
    sessionTime: z
      .object({
        date: z.string().optional().meta({ description: "Local date, e.g. `2026-12-02`." }),
        time: z.string().optional().meta({ description: "Local start time, e.g. `16:00`." }),
        length: z.string().optional().meta({ description: "Minutes, e.g. `60`." }),
        timezone: z.string().optional(),
      })
      .optional(),
    speakers: z
      .array(z.object({ name: z.string().optional() }))
      .max(100)
      .optional(),
    topics: taxonomy,
    tracks: taxonomy,
    industries: taxonomy,
    areasOfInterest: taxonomy,
    roles: taxonomy,
    services: taxonomy,
    segments: taxonomy,
    features: taxonomy,
    customerPersonas: taxonomy,
    experiences: taxonomy,
    additionalActivities: taxonomy,
    focusAreas: taxonomy,
  })
  .meta({ description: "A session exactly as the AWS Events API gives it." });
export type AwsSession = z.infer<typeof AwsSession>;

/** How many faces a session carries beside its count. */
export const goingFacesShown = 5;

export const ConnectionsGoing = z
  .object({
    count: z.int().min(0).meta({ description: "How many of my connections plan this session and let me see it." }),
    people: z.array(Person).max(goingFacesShown).meta({ description: `Up to ${goingFacesShown} of them, by display name, for avatars.` }),
  })
  .meta({ id: "ConnectionsGoing", description: "My connections going to a session, as their visibility lets me see." });
export type ConnectionsGoing = z.infer<typeof ConnectionsGoing>;

const instant = z.iso.datetime().meta({ description: "UTC instant, ISO-8601." });

export const Session = z
  .object({
    sessionId: SessionId,
    eventId: EventId,
    code: z.string().optional().meta({ example: "AIM3315" }),
    title: z.string().optional(),
    type: z.string().optional(),
    level: z.string().optional(),
    venue: z.string().optional(),
    room: z.string().optional(),
    startsAt: instant.optional(),
    endsAt: instant.optional(),
    isAllDay: z.boolean().optional(),
    speakers: z.array(z.string()).optional(),
    topics: z.array(z.string()).optional(),
    url: z
      .url()
      .optional()
      .meta({ description: "The session on the re:Invent site, where reading and reserving happen. Absent without a code." }),
    connectionsGoing: ConnectionsGoing.optional().meta({
      description: "On search and get, to a signed-in asker: how many of my connections are going, with a few faces.",
    }),
    lastSeenAt: instant.meta({ description: "When an agent last sent this session." }),
  })
  .meta({
    id: "Session",
    description:
      "A catalog snapshot of one session, as attendees' agents last sent it. Times are UTC; show them in the event's timezone. No abstract: follow `url` to read it.",
  });
export type Session = z.infer<typeof Session>;

export const Intent = z
  .enum(["interested", "reserved"])
  .meta({ description: "`interested` is an AWS favorite, `reserved` an AWS reservation." });
export const EntrySource = z
  .enum(["agent-sync", "manual"])
  .meta({ description: "`agent-sync` came from the attendee's agent; `manual` was added on Hallway." });

export const PlanEntry = z
  .object({
    sessionId: SessionId,
    intent: Intent,
    source: EntrySource,
    hidden: z.boolean().meta({ description: "Hidden entries are seen only by their owner." }),
    addedAt: instant,
    session: Session,
  })
  .meta({ id: "PlanEntry", description: "One session on my schedule." });
export type PlanEntry = z.infer<typeof PlanEntry>;

const count = z.int().min(0);

export const LastSync = z
  .object({
    syncedAt: instant.meta({ description: "When the sync landed." }),
    added: count.meta({ description: "Sessions it put on the schedule." }),
    removed: count.meta({ description: "Synced sessions it took off." }),
    changed: count.meta({ description: "Entries whose intent it changed." }),
    unchanged: count.meta({ description: "Sent sessions already on the schedule as they should be." }),
    missingSessions: count.meta({ description: "Listed ids it skipped for want of a session object." }),
  })
  .meta({ id: "LastSync", description: "What my agent's last sync for this event did, and when." });
export type LastSync = z.infer<typeof LastSync>;

export const MySchedule = z
  .object({
    eventId: EventId,
    timezone: z.string().meta({ description: "The event's IANA timezone, to show times in.", example: "America/Los_Angeles" }),
    entries: z.array(PlanEntry),
    lastSync: LastSync.optional().meta({ description: "Absent until my agent first syncs this event." }),
  })
  .meta({ id: "MySchedule", description: "My entries for one event, hidden ones included, in start order." });
export type MySchedule = z.infer<typeof MySchedule>;

/** Path of every `/api/events/{eventId}/my-schedule` route, and the `get_my_schedule` input. */
export const EventScope = z.object({ eventId: EventId });
export type EventScope = z.infer<typeof EventScope>;

/** Path of the per-entry and per-session routes. */
export const SessionScope = z.object({ eventId: EventId, sessionId: SessionId });
export type SessionScope = z.infer<typeof SessionScope>;

const idList = (description: string) => z.array(SessionId).max(1000).meta({ description });

export const SyncScheduleBody = z.object({
  sessions: z
    .array(AwsSession)
    .max(1000)
    .meta({
      description:
        "A session object (AWS's shape) for each id in `favorites` and `reserved`. Ids Hallway already has may be left out.",
    }),
  favorites: idList("`favorites` from AWS `GetSchedule`, unchanged."),
  reserved: idList("`reserved` from AWS `GetSchedule`, unchanged."),
});
export type SyncScheduleBody = z.infer<typeof SyncScheduleBody>;

/** `PUT /api/events/{eventId}/my-schedule` is EventScope plus this body; `sync_my_schedule` takes both at once. */
export const SyncScheduleInput = EventScope.extend(SyncScheduleBody.shape);
export type SyncScheduleInput = z.infer<typeof SyncScheduleInput>;

export const SyncResult = z
  .object({
    added: count.meta({ description: "Sessions newly on the schedule." }),
    removed: count.meta({ description: "Synced sessions no longer favorited or reserved on AWS." }),
    changed: count.meta({ description: "Entries whose intent changed (a favorite reserved, a reservation cancelled)." }),
    unchanged: count.meta({ description: "Sent sessions already on the schedule as they should be." }),
    sessionsStored: count.meta({ description: "Session snapshots saved to the catalog." }),
    missingSessions: z.array(SessionId).meta({
      description:
        "Listed ids sent without a session object that Hallway has never seen. They were skipped: send their `GetSession` output and sync again.",
    }),
  })
  .meta({ id: "SyncResult", description: "What one sync did." });
export type SyncResult = z.infer<typeof SyncResult>;

export const SetEntryHiddenBody = z.object({
  hidden: z.boolean().meta({ description: "True hides the entry from everyone but me." }),
});
export type SetEntryHiddenBody = z.infer<typeof SetEntryHiddenBody>;

export const SetEntryHiddenInput = SessionScope.extend(SetEntryHiddenBody.shape);
export type SetEntryHiddenInput = z.infer<typeof SetEntryHiddenInput>;

export const SearchSessionsQuery = z.object({
  q: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .optional()
    .meta({ description: "Matches the code, title or a speaker, ignoring case." }),
  day: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .meta({ description: "A day in the event's timezone; matches sessions starting on it.", example: "2026-12-01" }),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export const SearchSessionsInput = EventScope.extend(SearchSessionsQuery.shape);
export type SearchSessionsInput = z.infer<typeof SearchSessionsInput>;

export const SessionList = z
  .object({ sessions: z.array(Session) })
  .meta({ id: "SessionList", description: "Catalog sessions, in start order." });
export type SessionList = z.infer<typeof SessionList>;
