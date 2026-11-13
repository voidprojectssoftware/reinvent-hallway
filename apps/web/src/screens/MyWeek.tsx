// My week (docs/design/my-week.html): my schedule one day at a time, in Las
// Vegas time, said once under the title. The chosen day is in the URL
// (?day=2026-12-01) so a reload or a shared link keeps it. The same week can
// be drawn as a calendar instead (?view=calendar, WeekCalendar.tsx).
import type { Event, MySchedule, Person, PlanEntry } from "@hallway/contracts";
import { useState } from "react";
import { Link, useLoaderData, useSearchParams } from "react-router";
import { api } from "../api/client.ts";
import { clashes, clashLabel } from "../clash.ts";
import { EVENT_ID } from "../event.ts";
import { inSlot, parseSlot, slotMinutes } from "../schedule/calendar.ts";
import { DayChips, pickDate } from "../schedule/DayChips.tsx";
import { EntryCell } from "../schedule/EntryCell.tsx";
import { Going } from "../schedule/Going.tsx";
import { whoIsGoing } from "../schedule/going.ts";
import { WeekCalendar, type GoingNote } from "../schedule/WeekCalendar.tsx";
import { useWeekView, WeekViewToggle } from "../schedule/WeekView.tsx";
import { ShareSheet } from "../share/ShareSheet.tsx";
import { Empty } from "../shell/Empty.tsx";
import { Icon } from "../shell/Icon.tsx";
import { Screen } from "../shell/Screen.tsx";
import { requireSignIn } from "../shell/signed-in.ts";
import { eventDate, eventDates, formatAgo, formatDate, formatMinute, zoneAbbreviation } from "../time.ts";
import { WhyLink } from "../why/WhySheet.tsx";

type GoingBySession = Map<string, Person[]>;

export async function myWeekLoader({ request }: { request: Request }): Promise<{ event: Event; schedule: MySchedule; going: GoingBySession }> {
  const [event, schedule] = await Promise.all([api.getEvent(EVENT_ID), requireSignIn(api.mySchedule(EVENT_ID), request)]);
  const going: GoingBySession =
    schedule.entries.length > 0 ? await whoIsGoing(api, EVENT_ID, schedule.entries.map((entry) => entry.sessionId)) : new Map();
  return { event, schedule, going };
}

export function MyWeek() {
  const { event, schedule, going } = useLoaderData<typeof myWeekLoader>();
  const [search] = useSearchParams();
  const [view, setView] = useWeekView();
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
  const clashing = clashes(schedule.entries);
  const toggle = <WeekViewToggle view={view} onChange={setView} />;
  const synced = (
    <p className="gfoot">
      {schedule.lastSync && `Synced from your agent ${formatAgo(schedule.lastSync.syncedAt)}. `}
      Reserving happens on re:Invent; Hallway shows what you reserved there. <WhyLink section="schedule" />
    </p>
  );

  if (view === "calendar") {
    return (
      <Screen title="My week" sub={sub} action={share}>
        {toggle}
        <WeekCalendar
          entries={schedule.entries}
          dates={dates}
          clashing={clashing}
          going={(entry) => goingNote(entry, going)}
          cell={(entry) => cell(entry, clashing, going)}
          foot={synced}
        />
      </Screen>
    );
  }

  const chosen = pickDate(search.get("day"), dates, (date) => byDate.has(date));
  // A calendar slot's "+N more" opens the list at that half hour (?at=09:30).
  const slot = parseSlot(search.get("at"));
  const entries = (byDate.get(chosen) ?? []).filter((entry) => slot === null || inSlot(entry.session, chosen, slot));
  const untimed = schedule.entries.filter((entry) => !entry.session.startsAt);

  return (
    <Screen title="My week" sub={sub} action={share}>
      {toggle}
      <DayChips dates={dates} chosen={chosen} />

      <section className="section">
        <h2 className="ghead big">
          {formatDate(chosen)} <small>{count(entries.length)}</small>
        </h2>
        {slot !== null && (
          <p className="gfoot slot-note">
            On from {formatMinute(slot)} to {formatMinute(slot + slotMinutes)}.{" "}
            <Link to={{ search: `?view=list&day=${chosen}` }}>Show the whole day</Link>
          </p>
        )}
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
        {synced}
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

/** The count beside a block for the people I know going; a hidden entry is mine alone, as in the list. */
function goingNote(entry: PlanEntry, going: GoingBySession): GoingNote | undefined {
  const n = going.get(entry.sessionId)?.length ?? 0;
  if (entry.hidden || n === 0) return undefined;
  return { short: String(n), spoken: n === 1 ? "1 person you know is going" : `${n} people you know are going` };
}

const count = (n: number) => (n === 1 ? "1 session" : `${n} sessions`);
