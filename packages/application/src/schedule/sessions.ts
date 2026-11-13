// SearchSessions and GetSession (domain.md): the catalog attendees' agents
// built. Sessions are facts about the event, not about anyone, so any actor
// may read them; which of my connections are going arrives with the network
// slice.
import type { SearchSessionsInput, Session, SessionList, SessionScope } from "@hallway/contracts";
import { dayBounds } from "@hallway/domain";
import type { Actor } from "../actor.ts";
import { fail, ok, type Outcome } from "../outcome.ts";
import type { ScheduleDependencies } from "./dependencies.ts";
import { sessionResource } from "./resources.ts";
import type { SessionFilter } from "./schedule-repository.ts";

export type SearchSessions = (actor: Actor, input: SearchSessionsInput) => Promise<Outcome<SessionList>>;
export type GetSession = (actor: Actor, input: SessionScope) => Promise<Outcome<Session>>;

export function searchSessions({ events, schedule, sessionUrlTemplate }: ScheduleDependencies): SearchSessions {
  return async (_actor, { eventId, q, day, limit }) => {
    const event = await events.get(eventId);
    if (!event) return fail("not-found", `No event ${eventId}.`);
    const filter: SessionFilter = { limit };
    if (q !== undefined) filter.q = q;
    if (day !== undefined) {
      const bounds = dayBounds(day, event.timezone);
      if (!bounds) return fail("invalid", `${day} is not a date.`);
      filter.startsFrom = bounds.from;
      filter.startsBefore = bounds.to;
    }
    const sessions = await schedule.searchSessions(eventId, filter);
    return ok({ sessions: sessions.map((session) => sessionResource(session, sessionUrlTemplate)) });
  };
}

export function getSession({ schedule, sessionUrlTemplate }: ScheduleDependencies): GetSession {
  return async (_actor, { eventId, sessionId }) => {
    const session = await schedule.session(eventId, sessionId);
    return session
      ? ok(sessionResource(session, sessionUrlTemplate))
      : fail("not-found", `No session ${sessionId} in ${eventId}'s catalog.`);
  };
}
