// Find a session: search the sessions Hallway knows, by code, title or
// speaker, one day or all, and see who from my network is going to each.
// Until this screen a newcomer could reach a session only through someone
// else's week (issue #58, F12).
//
// Hallway's catalog is what attendees' agents have synced, not all of
// re:Invent, and the screen says so. The query and day are in the URL
// (?q=&day=), so the loader re-reads on each change and a reload or a
// shared link keeps the search. Anyone may search; a signed-in person also
// sees which results are on their week and who of their connections goes.
import type { Event, Session } from "@hallway/contracts";
import { useEffect, useRef, useState } from "react";
import { useLoaderData, useSearchParams } from "react-router";
import { api } from "../api/client.ts";
import { EVENT_ID } from "../event.ts";
import { EntryCell } from "../schedule/EntryCell.tsx";
import { Going } from "../schedule/Going.tsx";
import { Icon } from "../shell/Icon.tsx";
import { Screen } from "../shell/Screen.tsx";
import { ifSignedIn } from "../shell/signed-in.ts";
import { dayChip, eventDates, formatDate, zoneAbbreviation } from "../time.ts";
import { WhyLink } from "../why/WhySheet.tsx";

type Intent = "interested" | "reserved";

export async function sessionsLoader({ request }: { request: Request }): Promise<{
  event: Event;
  sessions: Session[];
  /** My intent per session id, when signed in. */
  mine: Map<string, Intent> | null;
}> {
  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim() ?? "";
  const day = url.searchParams.get("day") ?? "";
  const [event, found, schedule] = await Promise.all([
    api.getEvent(EVENT_ID),
    api.searchSessions(EVENT_ID, { q, day, limit: shownAtMost }),
    ifSignedIn(api.mySchedule(EVENT_ID)),
  ]);
  const mine = schedule && new Map(schedule.entries.map((entry) => [entry.sessionId, entry.intent] as const));
  return { event, sessions: found.sessions, mine };
}

/** Results asked for at once; a search that fills them says it shows only the first. */
const shownAtMost = 50;

/** How long typing pauses before the search runs. */
const typingPause = 300;

export function Sessions() {
  const { event, sessions, mine } = useLoaderData<typeof sessionsLoader>();
  const [search, setSearch] = useSearchParams();
  const asked = search.get("q") ?? "";
  const day = search.get("day") ?? "";
  const [typed, setTyped] = useState(asked);

  // Typing replaces the history entry rather than adding one per letter.
  // The setter is held in a ref: it changes on every render while the search
  // loads, and as a dependency it would restart the timer and the navigation
  // over and over.
  const searchFor = useRef(setSearch);
  searchFor.current = setSearch;
  useEffect(() => {
    if (typed.trim() === asked.trim()) return;
    const timer = setTimeout(() => void searchFor.current(params(typed.trim(), day), { replace: true }), typingPause);
    return () => clearTimeout(timer);
  }, [typed, asked, day]);

  const dates = eventDates(event.startDate, event.endDate);
  const heading = asked.trim() ? `Matching "${asked.trim()}"` : "Sessions";

  return (
    <Screen title="Find a session" navTitle="Sessions" sub={`${event.name} · times are Las Vegas time (${zoneAbbreviation(event.startDate)})`}>
      <form role="search" onSubmit={(e) => (e.preventDefault(), setSearch(params(typed.trim(), day), { replace: true }))}>
        <label className="search">
          <Icon name="search" />
          <span className="vh">Search by code, title or speaker</span>
          <input
            type="search"
            name="q"
            placeholder="Code, title or speaker"
            maxLength={200}
            autoComplete="off"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
          />
        </label>
      </form>

      <div className="days" role="group" aria-label="Day">
        <button type="button" className="day any" aria-pressed={day === ""} onClick={() => setSearch(params(asked, ""), { replace: true })}>
          <small>Any</small>
          <b>day</b>
        </button>
        {dates.map((date) => {
          const chip = dayChip(date);
          return (
            <button
              key={date}
              type="button"
              className="day"
              aria-pressed={date === day}
              aria-label={formatDate(date)}
              onClick={() => setSearch(params(asked, date), { replace: true })}
            >
              <small>{chip.weekday}</small>
              <b>{chip.day}</b>
            </button>
          );
        })}
      </div>

      <section className="section">
        <h2 className="ghead big">
          {heading} <small>{count(sessions.length)}</small>
        </h2>
        {sessions.length > 0 ? (
          <ul className="group">
            {sessions.map((session) => {
              const going = session.connectionsGoing;
              return (
                <EntryCell
                  key={session.sessionId}
                  session={session}
                  intent={mine?.get(session.sessionId)}
                  going={going && going.count > 0 && <Going people={going.people} total={going.count} />}
                />
              );
            })}
          </ul>
        ) : (
          <div className="group">
            <div className="empty">
              <b>No session found</b>
              <p>{asked.trim() ? "Try a session code such as AIM3315, a word from the title, or a speaker's name." : "Pick another day."}</p>
            </div>
          </div>
        )}
        <p className="gfoot">
          Hallway knows the sessions attendees' agents have synced, not the whole re:Invent catalog. A session missing here is on re:Invent:
          favorite it there and ask your agent to sync. <WhyLink section="description" />
        </p>
      </section>
    </Screen>
  );
}

function params(q: string, day: string): URLSearchParams {
  const next = new URLSearchParams();
  if (q) next.set("q", q);
  if (day) next.set("day", day);
  return next;
}

const count = (n: number) => (n === 1 ? "1 session" : n >= shownAtMost ? `first ${shownAtMost}` : `${n} sessions`);
