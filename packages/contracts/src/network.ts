// The network resources (docs/architecture/domain.md): Connection, Connection
// request, Contact import, Suggestion, and the reads over my connections'
// schedules (who is going, network agenda, meeting gaps, a person's schedule).
//
// People appear as `Person`, a face: enough to show and link to someone, and
// nothing private. No resource here carries an email, a LinkedIn subject, a
// verified name, or anything from an imported contact row.
import { z } from "zod";
import { EventId } from "./event.ts";
import { AttendeeCard, Handle, Person } from "./identity.ts";
import { EventScope, GoingPerson, Intent, Session, SessionId } from "./schedule.ts";

const instant = z.iso.datetime().meta({ description: "UTC instant, ISO-8601." });

export const Connection = z
  .object({
    person: Person,
    since: instant,
    via: z.enum(["request", "share-link"]).meta({ description: "How it formed: an accepted request, or a share link." }),
    sessions: z.int().min(0).optional().meta({
      description:
        "With `eventId` asked: how many sessions of theirs I may see at that event. Hidden entries, and every entry of a private schedule, are not counted.",
    }),
    sharedWithMe: z.int().min(0).optional().meta({
      description: "With `eventId` asked: how many of those sessions are also on my schedule.",
    }),
  })
  .meta({ id: "Connection", description: "Someone I am connected to. Connections see each other's `connections` schedules." });
export type Connection = z.infer<typeof Connection>;

/** `GET /api/me/connections?eventId=` and `list_my_connections`: the event to count sessions at. */
export const ListConnectionsInput = z.object({
  eventId: EventId.optional().meta({
    description: "Count each connection's sessions at this event (`sessions`, `sharedWithMe`). Without it, no counts.",
    example: "reinvent2026",
  }),
});
export type ListConnectionsInput = z.infer<typeof ListConnectionsInput>;

export const ConnectionList = z
  .object({ connections: z.array(Connection) })
  .meta({ id: "ConnectionList", description: "My connections, by display name." });
export type ConnectionList = z.infer<typeof ConnectionList>;

export const ConnectionRequest = z
  .object({
    id: z.string(),
    from: Person,
    to: Person,
    status: z.enum(["pending", "accepted", "declined", "withdrawn"]),
    createdAt: instant,
  })
  .meta({ id: "ConnectionRequest", description: "One attendee asking another to connect." });
export type ConnectionRequest = z.infer<typeof ConnectionRequest>;

export const RequestList = z
  .object({
    incoming: z.array(ConnectionRequest).meta({ description: "Pending requests to me, newest first." }),
    outgoing: z.array(ConnectionRequest).meta({ description: "Pending requests I sent, newest first." }),
  })
  .meta({ id: "RequestList", description: "My pending connection requests." });
export type RequestList = z.infer<typeof RequestList>;

export const RequestResult = z
  .object({
    request: ConnectionRequest,
    connection: Connection.optional().meta({
      description: "Present when this formed a connection: an accept, or a request to someone who had already asked me.",
    }),
  })
  .meta({ id: "RequestResult" });
export type RequestResult = z.infer<typeof RequestResult>;

/** `POST /api/me/connection-requests`. */
export const RequestConnectionInput = z.object({ handle: Handle }).meta({ id: "RequestConnection" });
export type RequestConnectionInput = z.infer<typeof RequestConnectionInput>;

/** Path of the accept, decline and withdraw routes. */
export const RequestScope = z.object({ requestId: z.string().min(1).max(64) });
export type RequestScope = z.infer<typeof RequestScope>;

/** Path of `/api/attendees/{handle}/connect` and `DELETE /api/me/connections/{handle}`. */
export const PersonScope = z.object({ handle: Handle });
export type PersonScope = z.infer<typeof PersonScope>;

export const ConnectBody = z
  .object({
    invite: z
      .string()
      .max(128)
      .optional()
      .meta({ description: "The `invite` from their share link (`/@handle?invite=...`). Without the current one, 403." }),
  })
  .meta({ id: "ConnectViaShareLink" });
export type ConnectBody = z.infer<typeof ConnectBody>;

export const ConnectInput = PersonScope.extend(ConnectBody.shape);
export type ConnectInput = z.infer<typeof ConnectInput>;

export const Invite = z
  .object({
    token: z.string().meta({ description: "The share link's secret, shown only to its owner. Rotating replaces it." }),
    path: z.string().meta({ description: "The share link: anyone signed in who opens it can connect at once.", example: "/@jane-doe?invite=AbC" }),
    rotatedAt: instant,
  })
  .meta({ id: "Invite", description: "My share link, which connects whoever opens it. Never in a public resource." });
export type Invite = z.infer<typeof Invite>;

/** A LinkedIn export is a few MB for 30,000 connections; ten is room to spare. */
export const maxContactsCsvBytes = 10_000_000;

export const ImportContactsInput = z.object({
  csv: z
    .string()
    .max(maxContactsCsvBytes)
    .meta({ description: "The `Connections.csv` from LinkedIn's data export, as it downloaded." }),
});
export type ImportContactsInput = z.infer<typeof ImportContactsInput>;

export const ContactImport = z
  .object({
    importedAt: instant,
    count: z.int().min(0).meta({ description: "Contacts kept: rows with a LinkedIn profile URL or an email." }),
  })
  .meta({
    id: "ContactImport",
    description:
      "My last upload of LinkedIn's Connections.csv. Only a normalized profile URL, a normalized name and an email hash are kept per row; company, position and the email itself are dropped as the file is read.",
  });
export type ContactImport = z.infer<typeof ContactImport>;

export const Suggestion = z
  .object({
    person: Person,
    reason: z.enum(["profile-and-name", "email"]).meta({
      description:
        "`email`: their verified email is in my export. `profile-and-name`: their LinkedIn URL and their LinkedIn-verified name both match one of my contacts.",
    }),
  })
  .meta({ id: "Suggestion", description: "An attendee I know on LinkedIn and am not yet connected to or asking." });
export type Suggestion = z.infer<typeof Suggestion>;

export const SuggestionList = z
  .object({
    suggestions: z.array(Suggestion),
    contactImport: ContactImport.optional().meta({ description: "Absent until I upload Connections.csv." }),
  })
  .meta({ id: "SuggestionList" });
export type SuggestionList = z.infer<typeof SuggestionList>;

const localDay = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .meta({ description: "A day in the event's timezone (Las Vegas).", example: "2026-12-01" });
/** "HH:MM", 00:00 to 23:59; an agenda's end may also be 24:00, the end of the day. */
const localTime = (description: string, example: string, endOfDay = false) =>
  z
    .string()
    .regex(endOfDay ? /^(([01]\d|2[0-3]):[0-5]\d|24:00)$/ : /^([01]\d|2[0-3]):[0-5]\d$/)
    .meta({ description, example });

// ---- A person's schedule ----

export const PersonEntry = z
  .object({
    sessionId: SessionId,
    intent: Intent,
    hidden: z.boolean().meta({ description: "True only on my own schedule: hidden entries are never shown to anyone else." }),
    session: Session,
  })
  .meta({ id: "PersonEntry", description: "One session on someone's schedule." });
export type PersonEntry = z.infer<typeof PersonEntry>;

export const PersonSchedule = z
  .object({
    attendee: AttendeeCard,
    eventId: EventId,
    timezone: z.string(),
    entries: z.array(PersonEntry),
  })
  .meta({ id: "PersonSchedule", description: "The entries of an attendee's schedule I may see, in start order." });
export type PersonSchedule = z.infer<typeof PersonSchedule>;

export const PersonScheduleQuery = z.object({ eventId: EventId });
export const GetPersonScheduleInput = z.object({ handle: Handle, eventId: EventId });
export type GetPersonScheduleInput = z.infer<typeof GetPersonScheduleInput>;

// ---- Who is going ----

/** The query string: comma-separated, so a GET carries the whole view. */
export const WhoIsGoingQuery = z.object({
  sessionIds: z
    .string()
    .min(1)
    .transform((text) => [...new Set(text.split(",").map((id) => id.trim()).filter(Boolean))])
    .pipe(z.array(SessionId).min(1).max(200))
    .meta({ description: "Session ids, comma-separated, up to 200.", example: "s-aim3315,s-dev318" }),
});
export const WhoIsGoingInput = EventScope.extend({
  sessionIds: z.array(SessionId).min(1).max(200).meta({ description: "Session ids, up to 200." }),
});
export type WhoIsGoingInput = z.infer<typeof WhoIsGoingInput>;

export const SessionGoing = z.object({
  sessionId: SessionId,
  people: z
    .array(GoingPerson)
    .meta({ description: "Every connection of mine going whose entry I may see, by display name, each with their intent." }),
});

export const WhoIsGoing = z
  .object({ sessions: z.array(SessionGoing).meta({ description: "One per asked id, in the order asked." }) })
  .meta({ id: "WhoIsGoing", description: "Per session, which of my connections plan to be there." });
export type WhoIsGoing = z.infer<typeof WhoIsGoing>;

// ---- Network agenda ----

export const NetworkAgendaQuery = z.object({
  day: localDay,
  from: localTime("Window start, Las Vegas time. Default 00:00.", "13:00").optional(),
  to: localTime("Window end, Las Vegas time. Default 24:00.", "18:00", true).optional(),
});
export const NetworkAgendaInput = EventScope.extend(NetworkAgendaQuery.shape);
export type NetworkAgendaInput = z.infer<typeof NetworkAgendaInput>;

export const AgendaItem = z.object({
  session: Session,
  people: z.array(GoingPerson).meta({ description: "My connections going, by display name, each with their intent." }),
});

export const NetworkAgenda = z
  .object({
    eventId: EventId,
    timezone: z.string(),
    from: instant,
    to: instant,
    items: z.array(AgendaItem).meta({ description: "Sessions starting in the window, in start order." }),
  })
  .meta({ id: "NetworkAgenda", description: "What my connections plan to attend in a window." });
export type NetworkAgenda = z.infer<typeof NetworkAgenda>;

// ---- Meeting gaps ----

export const MeetingGapsQuery = z.object({
  handle: Handle,
  day: localDay,
  from: localTime("Earliest start, Las Vegas time. Default 08:00.", "08:00").default("08:00"),
  to: localTime("Latest end, Las Vegas time. Default 18:00.", "18:00").default("18:00"),
  minMinutes: z.coerce.number().int().min(5).max(600).default(30).meta({ description: "Shortest gap worth listing." }),
});
export const MeetingGapsInput = EventScope.extend(MeetingGapsQuery.shape);
export type MeetingGapsInput = z.infer<typeof MeetingGapsInput>;

export const MeetingGaps = z
  .object({
    with: Person,
    day: z.string(),
    timezone: z.string(),
    gaps: z.array(
      z.object({
        startsAt: instant,
        endsAt: instant,
        start: z.string().meta({ description: "Las Vegas time, HH:MM.", example: "14:30" }),
        end: z.string().meta({ description: "Las Vegas time, HH:MM.", example: "15:30" }),
      }),
    ),
  })
  .meta({
    id: "MeetingGaps",
    description:
      "Windows on a day when neither of us has a session on the schedule I can see. All-day sessions (expo, lounges) do not block.",
  });
export type MeetingGaps = z.infer<typeof MeetingGaps>;
