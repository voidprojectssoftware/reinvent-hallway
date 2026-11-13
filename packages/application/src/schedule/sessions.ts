// SearchSessions and GetSession (domain.md): the catalog attendees' agents
// built. Sessions are facts about the event, not about anyone, so any actor
// may read them; a signed-in asker also sees how many of their connections
// are going, with a few faces, from one read for the whole list. These two
// are the only read paths that may carry an abstract, and only to a reader
// the domain's `canReadAbstract` allows (ADR 0025).
import { goingFacesShown, type SearchSessionsInput, type Session, type SessionList, type SessionScope } from "@hallway/contracts";
import { canReadAbstract, dayBounds, type AbstractReader } from "@hallway/domain";
import type { Actor } from "../actor.ts";
import { noEvent } from "../events/get-event.ts";
import { fail, ok, type Outcome } from "../outcome.ts";
import type { ScheduleDependencies } from "./dependencies.ts";
import { sessionResource } from "./resources.ts";
import type { CatalogSession, SessionFilter } from "./schedule-repository.ts";

export type SearchSessions = (actor: Actor, input: SearchSessionsInput) => Promise<Outcome<SessionList>>;
export type GetSession = (actor: Actor, input: SessionScope) => Promise<Outcome<Session>>;

export function searchSessions(dependencies: ScheduleDependencies): SearchSessions {
  const { events, schedule } = dependencies;
  return async (actor, { eventId, q, day, limit, ...exact }) => {
    const event = await events.get(eventId);
    if (!event) return noEvent(eventId);
    const filter: SessionFilter = { limit };
    if (q !== undefined) filter.q = q;
    for (const [key, value] of Object.entries(exact)) {
      if (value !== undefined) filter[key as keyof typeof exact] = value;
    }
    if (day !== undefined) {
      const bounds = dayBounds(day, event.timezone);
      if (!bounds) return fail("invalid", `${day} is not a date.`);
      filter.startsFrom = bounds.from;
      filter.startsBefore = bounds.to;
    }
    const { sessions, total } = await schedule.searchSessions(eventId, filter);
    return ok({
      sessions: await asResources(dependencies, actor, eventId, sessions),
      total,
      truncated: total > sessions.length,
    });
  };
}

export function getSession(dependencies: ScheduleDependencies): GetSession {
  return async (actor, { eventId, sessionId }) => {
    const session = await dependencies.schedule.session(eventId, sessionId);
    if (!session) return fail("not-found", `No session ${sessionId} in ${eventId}'s catalog.`);
    const [resource] = await asResources(dependencies, actor, eventId, [session]);
    return ok(resource!);
  };
}

/** Sessions as the asker sees them: with their connections going, and the abstract if the rule allows. */
async function asResources(
  { schedule, sessionUrlTemplate, connectionsGoing }: ScheduleDependencies,
  actor: Actor,
  eventId: string,
  sessions: readonly CatalogSession[],
): Promise<Session[]> {
  const ids = sessions.map((session) => session.sessionId);
  const [going, abstracts] = await Promise.all([
    connectionsGoing(actor, eventId, ids),
    abstractReader(schedule, actor, eventId).then((reader) =>
      canReadAbstract(reader) ? schedule.abstracts(eventId, ids) : undefined,
    ),
  ]);
  return sessions.map((session) => {
    const resource: Session = sessionResource(session, sessionUrlTemplate);
    const abstract = abstracts?.get(session.sessionId);
    if (abstract !== undefined) resource.abstract = abstract;
    if (!going) return resource;
    const people = going.get(session.sessionId) ?? [];
    return { ...resource, connectionsGoing: { count: people.length, people: people.slice(0, goingFacesShown) } };
  });
}

async function abstractReader(
  schedule: ScheduleDependencies["schedule"],
  actor: Actor,
  eventId: string,
): Promise<AbstractReader | null> {
  if (actor.kind !== "attendee") return null;
  return { attendeeId: actor.attendeeId, hasReportedSessions: await schedule.hasReported(actor.attendeeId, eventId) };
}
