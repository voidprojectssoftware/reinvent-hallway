// A week as a campus map, one day at a time (issue #93). Loaded only when the
// Map view opens (schedule/WeekMap.tsx), so Leaflet and the tile renderer stay
// out of every other screen's bundle.
//
// The map is never the only way to read the day: beside it is the same day as
// text, in order, with the walk between each two sessions and a warning when
// the time between them is shorter than the walk. Tapping a venue lists its
// sessions that day, each a link to the Session screen.
import "leaflet/dist/leaflet.css";
import type { Venues } from "@hallway/contracts";
import { useEffect, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router";
import { api } from "../api/client.ts";
import { EVENT_ID } from "../event.ts";
import { DayChips, pickDate } from "../schedule/DayChips.tsx";
import { sessionName, sessionPath } from "../schedule/EntryCell.tsx";
import type { CalendarEntry } from "../schedule/WeekCalendar.tsx";
import { eventDate, formatDate, formatTime } from "../time.ts";
import { CampusMap } from "./CampusMap.tsx";
import { dayPath, legLabel, type Leg } from "./day-path.ts";

export interface MapViewProps<E extends CalendarEntry> {
  entries: readonly E[];
  /** The week's days, first to last. */
  dates: readonly string[];
  /** The List | Calendar | Map switch, drawn at the right of the day's header. */
  toggle: ReactNode;
  /** A row for a session, as the list draws it. */
  cell: (entry: E) => ReactNode;
  /** The footnote under the day (My week's sync line). */
  foot?: ReactNode;
}

type Loaded = { state: "loading" } | { state: "failed" } | { state: "ready"; venues: Venues };

export default function MapView<E extends CalendarEntry>({ entries, dates, toggle, cell, foot }: MapViewProps<E>) {
  const [search, setSearch] = useSearchParams();
  const [loaded, setLoaded] = useState<Loaded>({ state: "loading" });
  useEffect(() => {
    let live = true;
    api.getVenues(EVENT_ID).then(
      (venues) => live && setLoaded({ state: "ready", venues }),
      () => live && setLoaded({ state: "failed" }),
    );
    return () => {
      live = false;
    };
  }, []);

  const busy = (date: string) => entries.some((entry) => entry.session.startsAt && eventDate(entry.session.startsAt) === date);
  const chosen = pickDate(search.get("day"), dates, busy);
  const venues = loaded.state === "ready" ? loaded.venues : { venues: [], walks: [] };
  const path = dayPath(entries, chosen, venues);
  const dayCount = path.stops.length + path.allDay.length;
  const name = (venueId: string | undefined) => venues.venues.find((venue) => venue.venueId === venueId)?.name;
  // The tapped venue is in the URL (?venue=wynn), so Back closes its list.
  const tapped = search.get("venue");
  const pin = path.pins.find((p) => p.venueId === tapped);
  const select = (venueId: string | null) =>
    setSearch(
      (current) => {
        const params = new URLSearchParams(current);
        if (venueId) params.set("venue", venueId);
        else params.delete("venue");
        return params;
      },
      { replace: true },
    );

  return (
    <>
      <DayChips dates={dates} chosen={chosen} />
      <section className="section">
        <div className="day-head">
          <h2 className="ghead big">
            <span className="day-name">{formatDate(chosen)}</span> <small>{dayCount === 1 ? "1 session" : `${dayCount} sessions`}</small>
          </h2>
          {toggle}
        </div>
        <div className="group campus">
          {loaded.state === "ready" ? (
            <CampusMap venues={loaded.venues} path={path} selected={pin?.venueId ?? null} onSelect={select} />
          ) : (
            <div className="campus-wait">{loaded.state === "loading" ? "Loading the map…" : "The map could not load. The day is listed below."}</div>
          )}
        </div>
        <p className="gfoot">
          Walks are measured building to building on OpenStreetMap footways (OSRM, FOSSGIS), not to the room. Campus shuttles
          run between most venues.
        </p>
      </section>

      {pin && (
        <section className="section">
          <h2 className="ghead">
            At {name(pin.venueId)} on {formatDate(chosen).split(" ")[0]}
            <button type="button" className="linkbtn" onClick={() => select(null)}>
              Close
            </button>
          </h2>
          <ul className="group">{pin.entries.map(cell)}</ul>
        </section>
      )}

      <section className="section">
        <h2 className="ghead">The day in order</h2>
        {dayCount === 0 ? (
          <div className="group">
            <div className="empty">
              <b>Nothing on this day</b>
              <p>Pick another day.</p>
            </div>
          </div>
        ) : (
          <ol className="group day-order">
            {path.allDay.map((entry) => (
              <li key={entry.sessionId}>
                <StopRow entry={entry} number={null} venue={name(entry.session.venueId)} />
              </li>
            ))}
            {path.stops.map((stop, index) => {
              const leg = index > 0 ? path.legs[index - 1] : undefined;
              return (
                <li key={stop.entry.sessionId}>
                  {leg && <LegRow leg={leg} />}
                  <StopRow entry={stop.entry} number={stop.number} venue={name(stop.entry.session.venueId)} />
                </li>
              );
            })}
          </ol>
        )}
        {foot}
      </section>

      {path.unplaced.length > 0 && (
        <section className="section">
          <h2 className="ghead">Not on the map</h2>
          <ul className="group">{path.unplaced.map(cell)}</ul>
          <p className="gfoot">Hallway does not know where these venues are yet, so they have no pin and no walking time.</p>
        </section>
      )}
    </>
  );
}

function StopRow({ entry, number, venue }: { entry: CalendarEntry; number: number | null; venue: string | undefined }) {
  const { session } = entry;
  const where = venue ?? (session.venue ? `${session.venue} (not on the map)` : "Venue not announced");
  return (
    <Link className="cell stop" to={sessionPath(session.sessionId)}>
      <span className={number === null ? "stop-n allday" : "stop-n"} aria-hidden="true">
        {number ?? "·"}
      </span>
      <span className="cellmain">
        <span className="stop-when">
          {number === null ? "All day" : formatTime(session.startsAt!)}
          {number !== null && session.endsAt && ` to ${formatTime(session.endsAt)}`}
        </span>
        <span className="celltitle">{sessionName(session)}</span>
        <span className="cellsub">
          {session.code && <span className="code">{session.code}</span>}
          {session.code && " · "}
          {where}
          {session.room && `, ${session.room}`}
        </span>
      </span>
    </Link>
  );
}

function LegRow({ leg }: { leg: Leg<CalendarEntry> }) {
  return (
    <p className={leg.tight ? "leg tight" : "leg"}>
      {leg.tight && <b>Tight: </b>}
      {legLabel(leg)}
    </p>
  );
}
