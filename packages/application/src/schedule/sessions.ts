// SearchSessions and GetSession (domain.md): the catalog attendees' agents
// built. Sessions are facts about the event, not about anyone, so any actor
// may read them; a signed-in asker also sees how many of their connections
// are going, with a few faces, from one read for the whole list.
import { goingFacesShown, type SearchSessionsInput, type Session, type SessionList, type SessionScope } from "@hallway/contracts";
import { dayBounds } from "@hallway/domain";
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
  return async (actor, { eventId, q, day, limit }) => {
    const event = await events.get(eventId);
    if (!event) return noEvent(eventId);
    const filter: SessionFilter = { limit };
    if (q !== undefined) filter.q = q;
    if (day !== undefined) {
      const bounds = dayBounds(day, event.timezone);
      if (!bounds) return fail("invalid", `${day} is not a date.`);
      filter.startsFrom = bounds.from;
      filter.startsBefore = bounds.to;
    }
    const { sessions, total } = await schedule.searchSessions(eventId, filter);
    return ok({
      sessions: await withConnectionsGoing(dependencies, actor, eventId, sessions),
      total,
      truncated: total > sessions.length,
    });
  };
}

export function getSession(dependencies: ScheduleDependencies): GetSession {
  return async (actor, { eventId, sessionId }) => {
    const session = await dependencies.schedule.session(eventId, sessionId);
    if (!session) return fail("not-found", `No session ${sessionId} in ${eventId}'s catalog.`);
    const [resource] = await withConnectionsGoing(dependencies, actor, eventId, [session]);
    return ok(resource!);
  };
}

async function withConnectionsGoing(
  { sessionUrlTemplate, connectionsGoing }: ScheduleDependencies,
  actor: Actor,
  eventId: string,
  sessions: readonly CatalogSession[],
): Promise<Session[]> {
  const going = await connectionsGoing(actor, eventId, sessions.map((session) => session.sessionId));
  return sessions.map((session) => {
    const resource = sessionResource(session, sessionUrlTemplate);
    if (!going) return resource;
    const people = going.get(session.sessionId) ?? [];
    return { ...resource, connectionsGoing: { count: people.length, people: people.slice(0, goingFacesShown) } };
  });
}
