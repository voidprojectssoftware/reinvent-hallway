// My week (docs/design/my-week.html): my schedule one day at a time, in Las
// Vegas time, said once under the title. The chosen day is in the URL
// (?day=2026-12-01) so a reload or a shared link keeps it.
import type { Event, MySchedule, Person, PlanEntry } from "@hallway/contracts";
import { useState } from "react";
import { Link, useLoaderData, useSearchParams } from "react-router";
import { api } from "../api/client.ts";
import { clashes, clashLabel } from "../clash.ts";
import { EVENT_ID } from "../event.ts";
import { EntryCell } from "../schedule/EntryCell.tsx";
import { Going } from "../schedule/Going.tsx";
import { whoIsGoing } from "../schedule/going.ts";
import { ShareSheet } from "../share/ShareSheet.tsx";
import { Empty } from "../shell/Empty.tsx";
import { Icon } from "../shell/Icon.tsx";
import { Screen } from "../shell/Screen.tsx";
import { requireSignIn } from "../shell/signed-in.ts";
import { dayChip, eventDate, eventDates, formatAgo, formatDate, zoneAbbreviation } from "../time.ts";

type GoingBySession = Map<string, Person[]>;

export async function myWeekLoader({ request }: { request: Request }): Promise<{ event: Event; schedule: MySchedule; going: GoingBySession }> {
  const [event, schedule] = await Promise.all([api.getEvent(EVENT_ID), requireSignIn(api.mySchedule(EVENT_ID), request)]);
  const going: GoingBySession =
    schedule.entries.length > 0 ? await whoIsGoing(api, EVENT_ID, schedule.entries.map((entry) => entry.sessionId)) : new Map();
  return { event, schedule, going };
}

export function MyWeek() {
  const { event, schedule, going } = useLoaderData<typeof myWeekLoader>();
  const [search, setSearch] = useSearchParams();
  const [sharing, setSharing] = useState(false);
  const sub = `${event.name} · times are Las Vegas time (${zoneAbbreviation(event.startDate)})`;
  const share = (
    <>
      <button className="navbtn icon" type="button" aria-label="Share my week" onClick={() => setSharing(true)}>
        <Icon name="share" />
      </button>
      {sharing && <ShareSheet onClose={() => setSharing(false)} />}
    </>
  );

  if (schedule.entries.length === 0) {
    // An agent that synced and found nothing is not one that never
    // connected: the next step is on re:Invent, not here.
    const synced = schedule.lastSync;
    return (
      <Screen title="My week" sub={sub} action={share}>
        {synced ? (
          <Empty
            icon="week"
            title="Your agent found nothing to add"
            action={
              <Link className="btn" to="/sessions">
                Find a session
              </Link>
            }
          >
            Your agent synced {formatAgo(synced.syncedAt)} and found no favorites or reservations on re:Invent. Favorite or reserve
            sessions there and ask your agent again, or find a session here and add it.
          </Empty>
        ) : (
          <Empty
            icon="week"
            title="Nothing on your week yet"
            action={
              <>
                <Link className="btn" to="/connect">
                  Connect your agent
                </Link>
                <Link className="btn gray" to="/sessions">
                  Find a session
                </Link>
              </>
            }
          >
            Ask your agent to put your re:Invent favorites and reservations here, or find a session and add it.
          </Empty>
        )}
      </Screen>
    );
  }

  const byDate = groupByDate(schedule.entries);
  const dates = [...new Set([...eventDates(event.startDate, event.endDate), ...byDate.keys()])].sort();
  const chosen = pickDate(search.get("day"), dates, byDate);
  const today = eventDate(new Date());
  const entries = byDate.get(chosen) ?? [];
  const untimed = schedule.entries.filter((entry) => !entry.session.startsAt);
  const clashing = clashes(schedule.entries);

  return (
    <Screen title="My week" sub={sub} action={share}>
      <div className="days" role="group" aria-label="Day">
        {dates.map((date) => {
          const { weekday, day } = dayChip(date);
          return (
            <button
              key={date}
              type="button"
              className="day"
              aria-pressed={date === chosen}
              aria-current={date === today ? "date" : undefined}
              aria-label={formatDate(date)}
              onClick={() => setSearch({ day: date }, { replace: true })}
            >
              <small>{weekday}</small>
              <b>{day}</b>
            </button>
          );
        })}
      </div>

      <section className="section">
        <h2 className="ghead big">
          {formatDate(chosen)} <small>{count(entries.length)}</small>
        </h2>
        {entries.length > 0 ? (
          <ul className="group">{entries.map((entry) => cell(entry, clashing, going))}</ul>
        ) : (
          <div className="group">
            <div className="empty">
              <b>Nothing on this day</b>
              <p>
                Pick another day, or <Link to={`/sessions?day=${chosen}`}>find a session</Link> on this one.
              </p>
            </div>
          </div>
        )}
        <p className="gfoot">
          {schedule.lastSync && `Synced from your agent ${formatAgo(schedule.lastSync.syncedAt)}. `}
          Reserving happens on re:Invent; Hallway shows what you reserved there.
        </p>
      </section>

      {untimed.length > 0 && (
        <section className="section">
          <h2 className="ghead">Time not announced yet</h2>
          <ul className="group">{untimed.map((entry) => cell(entry, clashing, going))}</ul>
        </section>
      )}
    </Screen>
  );
}

function cell(entry: PlanEntry, clashing: Map<string, string[]>, going: GoingBySession) {
  const names = clashing.get(entry.sessionId);
  const people = going.get(entry.sessionId);
  return (
    <EntryCell
      key={entry.sessionId}
      session={entry.session}
      intent={entry.intent}
      hidden={entry.hidden}
      clash={names && clashLabel(names)}
      // A hidden entry is mine alone, so the design leaves who is going off it.
      going={!entry.hidden && people && <Going people={people} />}
    />
  );
}

function groupByDate(entries: readonly PlanEntry[]): Map<string, PlanEntry[]> {
  const byDate = new Map<string, PlanEntry[]>();
  for (const entry of entries) {
    if (!entry.session.startsAt) continue;
    const date = eventDate(entry.session.startsAt);
    byDate.set(date, [...(byDate.get(date) ?? []), entry]);
  }
  return byDate;
}

/** The day asked for, else today during the event, else the first day with something on it. */
function pickDate(asked: string | null, dates: string[], byDate: Map<string, PlanEntry[]>): string {
  if (asked && dates.includes(asked)) return asked;
  const today = eventDate(new Date());
  if (dates.includes(today)) return today;
  return dates.find((date) => byDate.has(date)) ?? dates[0] ?? today;
}

const count = (n: number) => (n === 1 ? "1 session" : `${n} sessions`);
