// The schedule resources (docs/architecture/domain.md): Session, Plan entry,
// and what SyncSchedule takes and returns.
//
// The sync input accepts AWS's own `Session` shape (the AWS Events API spec,
// docs/discovery/aws-events-api/openapi-2026-11-13.json) so an agent can pass
// `GetSession` output straight through. Hallway keeps all of it but AWS's
// live state (`isReservable`, `seatAvailability`), which is accepted so the
// pass-through validates and never read (ADR 0025). The abstract leaves
// Hallway only on search and get, and only to a reader the domain's
// `canReadAbstract` allows.
import { z } from "zod";
import { EventId } from "./event.ts";
import { Person } from "./identity.ts";

export const SessionId = z
  .string()
  .min(1)
  .max(128)
  .meta({ description: "AWS's session id, stable across requests." });

// AWS types every field below as a string (or a list, or a flag) and never
// documents null, but models re-serialize ("60" becomes 60) and other MCP
// bridges send null for a field they have no value for. One such field used
// to fail a whole sync (hunt F11). So null reads as absent, and a number where
// AWS gives minutes reads as its digits; any other wrong type is still
// refused, with the path of the field.
const orAbsent = <T extends z.ZodType>(schema: T) =>
  schema
    .nullish()
    .transform((value) => value ?? undefined)
    .optional();
const text = () => orAbsent(z.string());
const taxonomy = orAbsent(z.array(z.string()).max(100));

/**
 * Far above any abstract AWS writes (about a thousand characters), so a real
 * one always passes and a sync cannot be used to store a book.
 */
const abstractMaxLength = 20_000;

/** AWS's `Session`, as `GetSession` returns it or `ListSessions` lists it. */
export const AwsSession = z
  .object({
    sessionId: SessionId,
    title: text(),
    abbreviation: text().meta({ description: "The public session code, e.g. `AIM3315`." }),
    abstract: orAbsent(z.string().max(abstractMaxLength)).meta({
      description:
        "AWS's description of the session, as `GetSession` gives it. Kept, and shown only to attendees whose own agent has synced sessions.",
    }),
    type: text(),
    level: text(),
    venue: text(),
    room: text(),
    isAllDaySession: orAbsent(z.boolean()),
    isReservable: orAbsent(z.boolean()),
    seatAvailability: text(),
    sessionTime: orAbsent(
      z.object({
        date: text().meta({ description: "Local date, `YYYY-MM-DD`, e.g. `2026-12-02`." }),
        time: text().meta({ description: "Local start time, 24-hour `HH:MM` (or `HH:MM:SS`), e.g. `16:00`." }),
        length: orAbsent(
          z
            .union([z.string(), z.number()], { error: "Expected whole minutes, as a string (\"60\") or a number" })
            .transform((minutes) => (typeof minutes === "number" ? String(minutes) : minutes)),
        ).meta({ description: "Whole minutes, e.g. `\"60\"` (a number is read too)." }),
        timezone: text(),
      }),
    ),
    speakers: orAbsent(z.array(z.object({ name: text() })).max(100)),
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
  .meta({ description: "A session exactly as the AWS Events API gives it. A null field is read as absent." });
export type AwsSession = z.infer<typeof AwsSession>;

export const Intent = z
  .enum(["interested", "reserved"])
  .meta({
    description:
      "`interested` is an AWS favorite, `reserved` an AWS reservation or invitation. A session added by hand is `reserved` while the latest sync says it is reserved, and `interested` otherwise.",
  });
export type Intent = z.infer<typeof Intent>;

/**
 * A connection going to a session, with how sure they are: what the design
 * draws as the Reserved or Interested badge. Only from an entry the viewer
 * may see (domain.md), so a hidden entry never lends anyone an intent.
 */
export const GoingPerson = Person.extend({
  intent: Intent.meta({ description: "`reserved`: they have a seat. `interested`: a favorite or added on Hallway." }),
}).meta({ id: "GoingPerson", description: "One of my connections going to a session, and whether they have a seat." });
export type GoingPerson = z.infer<typeof GoingPerson>;

/** How many faces a session carries beside its count. */
export const goingFacesShown = 5;

export const ConnectionsGoing = z
  .object({
    count: z.int().min(0).meta({ description: "How many of my connections plan this session and let me see it." }),
    people: z.array(GoingPerson).max(goingFacesShown).meta({ description: `Up to ${goingFacesShown} of them, by display name, for avatars.` }),
  })
  .meta({ id: "ConnectionsGoing", description: "My connections going to a session, as their visibility lets me see." });
export type ConnectionsGoing = z.infer<typeof ConnectionsGoing>;

const instant = z.iso.datetime().meta({ description: "UTC instant, ISO-8601." });
const tagList = (description: string) => z.array(z.string()).optional().meta({ description });

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
    abstract: z.string().optional().meta({
      description:
        "AWS's plain-text description, from what attendees' agents sent. Only on search and get, and only to an attendee whose own agent has synced sessions for this event: AWS shows it only to registered attendees. Render it as text.",
    }),
    tracks: tagList("Programming tracks, e.g. `Developer Productivity`."),
    topics: tagList("Technology domains, e.g. `Artificial Intelligence`."),
    industries: tagList("Industries it is aimed at."),
    areasOfInterest: tagList("Broader interest areas, e.g. `Generative AI`."),
    roles: tagList("Job roles it is aimed at, e.g. `Developer / Engineer`."),
    services: tagList("AWS services it covers, e.g. `Amazon Bedrock`."),
    segments: tagList("Audience segments, e.g. `Enterprise`."),
    features: tagList("Format labels, e.g. `Interactive`."),
    customerPersonas: tagList("Customer personas it is aimed at."),
    experiences: tagList("Programs it belongs to; attendance may be limited to that program's participants."),
    additionalActivities: tagList("Activities that go with it."),
    focusAreas: tagList("Focus areas it is tagged with."),
    url: z
      .url()
      .optional()
      .meta({ description: "The session on the re:Invent site, where reading and reserving happen. Absent without a code." }),
    connectionsGoing: ConnectionsGoing.optional().meta({
      description: "On search and get, to a signed-in asker: how many of my connections are going, with a few faces.",
    }),
    lastSeenAt: instant.meta({ description: "When an agent last reported this session." }),
  })
  .meta({
    id: "Session",
    description:
      "One session as the catalog shows it: per field, what most attendees' agents report of it. Times are UTC; show them in the event's timezone. `abstract` only to attendees whose own agent has synced; otherwise follow `url` to read it on re:Invent.",
  });
export type Session = z.infer<typeof Session>;

export const EntrySource = z
  .enum(["agent-sync", "manual"])
  .meta({ description: "`agent-sync` came from the attendee's agent; `manual` was added on Hallway." });

export const PlanEntry = z
  .object({
    sessionId: SessionId,
    intent: Intent,
    source: EntrySource,
    invited: z.boolean().meta({
      description: "The event placed it on my schedule (AWS `invitedSessions`); shown as invited, held like a reservation.",
    }),
    hidden: z.boolean().meta({
      description: "Hidden entries are seen only by their owner. Hiding is kept per session, so it holds if the session leaves my schedule and comes back.",
    }),
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
        "A session object (AWS's shape) for each id in `favorites` and `reserved`. Ids Hallway already has may be left out. A session in neither list is ignored: an agent reports only sessions on its own attendee's schedule.",
    }),
  favorites: idList("`favorites` from AWS `GetSchedule`, unchanged."),
  reserved: idList("`reserved` from AWS `GetSchedule`, unchanged."),
  invitedSessions: z
    .array(AwsSession)
    .max(1000)
    .default([])
    .meta({
      description:
        "`invitedSessions` from AWS `GetSchedule`, unchanged: whole sessions the event placed on the schedule by invitation. Each is held like a reservation and marked invited.",
    }),
});
export type SyncScheduleBody = z.infer<typeof SyncScheduleBody>;

/** `PUT /api/events/{eventId}/my-schedule` is EventScope plus this body; `sync_my_schedule` takes both at once. */
export const SyncScheduleInput = EventScope.extend(SyncScheduleBody.shape);
export type SyncScheduleInput = z.infer<typeof SyncScheduleInput>;

export const UnreadableTime = z
  .object({
    sessionId: SessionId,
    date: z.string().optional().meta({ description: "The `date` as sent, when it is not `YYYY-MM-DD`." }),
    time: z.string().optional().meta({ description: "The `time` as sent, when it is not 24-hour `HH:MM`." }),
    length: z.string().optional().meta({ description: "The `length` as sent, when it is not whole minutes." }),
  })
  .meta({ id: "UnreadableTime", description: "A session whose time Hallway could not read, with those parts as sent." });
export type UnreadableTime = z.infer<typeof UnreadableTime>;

export const SyncResult = z
  .object({
    added: count.meta({ description: "Sessions newly on the schedule." }),
    removed: count.meta({ description: "Synced sessions no longer favorited or reserved on AWS." }),
    changed: count.meta({ description: "Entries whose intent changed (a favorite reserved, a reservation cancelled)." }),
    unchanged: count.meta({ description: "Sent sessions already on the schedule as they should be." }),
    sessionsStored: count.meta({
      description: "Snapshots kept as this attendee's report of a listed session. The catalog shows what most reporters agree on.",
    }),
    missingSessions: z.array(SessionId).meta({
      description:
        "Listed ids sent without a session object that Hallway has never seen. They were skipped: send their `GetSession` output and sync again.",
    }),
    unreadableTimes: z.array(UnreadableTime).meta({
      description:
        "Sessions kept without a time because a part of their `sessionTime` is not in a form Hallway reads. Such a session shows as time not announced (or keeps a time an earlier sync gave it) and does not block meeting gaps. Send AWS's values unchanged and sync again.",
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

const tagFilter = (description: string) => z.string().trim().min(1).max(200).optional().meta({ description });

export const SearchSessionsQuery = z.object({
  q: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .optional()
    .meta({ description: "Matches the code, title or a speaker, ignoring case and accents." }),
  day: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .meta({ description: "A day in the event's timezone; matches sessions starting on it.", example: "2026-12-01" }),
  type: tagFilter("The session type, exactly as sessions carry it, e.g. `Breakout session`."),
  level: tagFilter("The level, exactly as sessions carry it, e.g. `300 - Advanced`."),
  topic: tagFilter("One of the session's `topics`, exactly, e.g. `Artificial Intelligence`."),
  track: tagFilter("One of the session's `tracks`, exactly."),
  service: tagFilter("One of the session's `services`, exactly, e.g. `Amazon Bedrock`."),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export const SearchSessionsInput = EventScope.extend(SearchSessionsQuery.shape);
export type SearchSessionsInput = z.infer<typeof SearchSessionsInput>;

export const SessionList = z
  .object({
    sessions: z.array(Session),
    total: count.meta({ description: "How many sessions match; `sessions` holds the first `limit` of them." }),
    truncated: z.boolean().meta({
      description: "True when more sessions match than were returned: narrow the search (`q`, `day`) or raise `limit` (up to 200).",
    }),
  })
  .meta({ id: "SessionList", description: "Catalog sessions, in start order." });
export type SessionList = z.infer<typeof SessionList>;
