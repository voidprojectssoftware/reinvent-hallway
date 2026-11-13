// A week as a calendar (issue #91): a time grid in Las Vegas time, one day at
// a time on a phone (with the day chips), the whole week side by side from
// 768 px. The same entries the list draws, laid out by calendar.ts; the list
// stays one tap away, so the grid is never the only way to read the week.
//
// Each block is a link to the session, named in full for a screen reader
// (code, title, day and time, place, intent and flags), since the block
// itself shows only what fits. Blocks come in time order within each day, so
// the keyboard reads the week in order.
import type { PlanEntry, Session } from "@hallway/contracts";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router";
import { clashLabel } from "../clash.ts";
import { Icon } from "../shell/Icon.tsx";
import { dayChip, eventDate, formatDate, formatMinute, formatTime, formatTimeRange, minuteOfDay } from "../time.ts";
import { hoursShown, layoutDay, slotMinutes, slotParam, spanOf, type Span } from "./calendar.ts";
import { DayChips, DayCount, pickDate } from "./DayChips.tsx";
import { sessionName, sessionPath } from "./EntryCell.tsx";

export interface CalendarEntry {
  sessionId: string;
  session: Session;
  intent: PlanEntry["intent"];
  hidden: boolean;
}

/** Who is going, for a block: a few characters drawn beside the people glyph, and the words a screen reader hears. */
export interface GoingNote {
  short: string;
  spoken: string;
}

interface WeekCalendarProps<E extends CalendarEntry> {
  entries: readonly E[];
  /** The week's days, first to last. */
  dates: readonly string[];
  /** "Same time as SVS401", by session, on my own week. */
  clashing?: Map<string, string[]>;
  going?: (entry: E) => GoingNote | undefined;
  /** A row for a session with no time yet, listed under the grid as the list draws it. */
  cell: (entry: E) => ReactNode;
  /** The footnote under the grid, as the list has under its day (My week's sync line). */
  foot?: ReactNode;
  /** The List | Calendar | Map switch, at the right of the day's header (or the week's, side by side). */
  toggle?: ReactNode;
}

/** The narrowest block worth drawing: a session code and a short word of title fit (at 60 px, codes and titles were cut to three letters). */
const narrowestBlock = 84;
const wide = "(min-width: 768px)";

export function WeekCalendar<E extends CalendarEntry>({ entries, dates, clashing, going, cell, foot, toggle }: WeekCalendarProps<E>) {
  const [search] = useSearchParams();
  const sideBySide = useMediaQuery(wide);
  const [dayWidth, measure] = useWidth();
  const now = useNow();

  const timed = entries.flatMap((entry) => {
    const span = spanOf(entry.session);
    return span ? [{ entry, span }] : [];
  });
  const allDay = entries.filter((entry) => entry.session.isAllDay && entry.session.startsAt);
  const untimed = entries.filter((entry) => !entry.session.startsAt);
  const busy = (date: string) => timed.some(({ span }) => span.date === date) || allDay.some((entry) => onDate(entry.session, date));
  const chosen = pickDate(search.get("day"), dates, busy);
  const shown = sideBySide ? dates : [chosen];
  const timedShown = sideBySide ? timed : timed.filter(({ span }) => span.date === chosen);
  // One day on a phone runs over its own hours, not the week's (#114): an
  // 11:30 PM session on Wednesday no longer gives Tuesday five empty hours to
  // scroll past. Side by side, the days share one axis.
  const hours = hoursShown(timedShown.map(({ span }) => span));
  const maxLanes = Math.floor(dayWidth / narrowestBlock);
  const allDayShown = allDay.filter((entry) => shown.some((date) => onDate(entry.session, date)));
  const today = eventDate(now);
  const style = { "--days": shown.length, "--slots": (hours.end - hours.start) / slotMinutes } as CSSProperties;

  return (
    <>
      {!sideBySide && <DayChips dates={dates} chosen={chosen} />}
      <section className="section">
        <div className="day-head">
          {sideBySide ? (
            <h2 className="ghead big">
              <span className="day-name">The week</span> <small>{count(timed.length + allDayShown.length)}</small>
            </h2>
          ) : (
            <DayCount date={chosen} count={timedShown.length + allDayShown.length} />
          )}
          {toggle}
        </div>
        <div className={sideBySide ? "cal week" : "cal"} style={style}>
          {sideBySide && (
            <div className="cal-row cal-head" aria-hidden="true">
              <span />
              {shown.map((date) => {
                const { weekday, day } = dayChip(date);
                return (
                  <span key={date} className={date === today ? "cal-dayhead today" : "cal-dayhead"}>
                    {weekday} <b>{day}</b>
                  </span>
                );
              })}
            </div>
          )}
          {allDayShown.length > 0 && (
            <div className="cal-row cal-allday">
              <span className="cal-axis-label">All day</span>
              {shown.map((date) => (
                <ul key={date} className="cal-allday-day" aria-label={`All day, ${formatDate(date)}`}>
                  {allDayShown
                    .filter((entry) => onDate(entry.session, date))
                    .map((entry) => (
                      <li key={entry.sessionId}>
                        <Block entry={entry} name={blockName(entry, null, clashing, going?.(entry))} going={going?.(entry)} />
                      </li>
                    ))}
                </ul>
              ))}
            </div>
          )}
          <div className="cal-row cal-body">
            <div className="cal-axis" aria-hidden="true">
              {hourMarks(hours).map((minute) => (
                <span key={minute} style={{ "--at": (minute - hours.start) / slotMinutes } as CSSProperties}>
                  {formatMinute(minute)}
                </span>
              ))}
            </div>
            {shown.map((date, index) => {
              const { placed, more } = layoutDay(
                timed.filter(({ span }) => span.date === date),
                maxLanes,
              );
              const nowAt = date === today ? minuteOfDay(now) : null;
              return (
                <section key={date} className="cal-day" aria-label={formatDate(date)} ref={index === 0 ? measure : undefined}>
                  <ol>
                    {placed.map(({ item: { entry, span }, lane, lanes }) => (
                      <li key={entry.sessionId} className="cal-slot" style={place(span.start - hours.start, span.end - span.start, lane, lanes)}>
                        <Block
                          entry={entry}
                          name={blockName(entry, span, clashing, going?.(entry))}
                          going={going?.(entry)}
                          clash={clashing?.get(entry.sessionId)}
                          crossesMidnight={span.crossesMidnight}
                        />
                      </li>
                    ))}
                    {more.map((slot) => (
                      <li key={`more-${slot.start}`} className="cal-slot" style={place(slot.start - hours.start, slotMinutes, slot.lane, slot.lanes)}>
                        <Link
                          className="cal-more"
                          to={{ search: `?view=list&day=${date}&at=${slotParam(slot.start)}` }}
                          aria-label={`${slot.count} more from ${formatMinute(slot.start)}, in the list`}
                        >
                          +{slot.count} more
                        </Link>
                      </li>
                    ))}
                  </ol>
                  {nowAt !== null && nowAt >= hours.start && nowAt <= hours.end && (
                    <div className="cal-now" style={{ "--top": nowAt - hours.start } as CSSProperties} role="img" aria-label={`Now, ${formatTime(now)}`} />
                  )}
                </section>
              );
            })}
          </div>
        </div>
        {!sideBySide && !busy(chosen) && <p className="gfoot">Nothing on this day. Pick another day.</p>}
        {foot}
      </section>

      {untimed.length > 0 && (
        <section className="section">
          <h2 className="ghead">Time not announced yet</h2>
          <ul className="group">{untimed.map(cell)}</ul>
        </section>
      )}
    </>
  );
}

interface BlockProps {
  entry: CalendarEntry;
  name: string;
  going?: GoingNote | undefined;
  clash?: string[] | undefined;
  crossesMidnight?: boolean;
}

function Block({ entry, name, going, clash, crossesMidnight = false }: BlockProps) {
  const { session } = entry;
  const classes = ["cal-block", entry.intent === "reserved" ? "reserved" : "interested", entry.hidden && "hidden-entry", crossesMidnight && "past-midnight"];
  const place = [session.venue, session.room].filter(Boolean).join(", ");
  return (
    <Link className={classes.filter(Boolean).join(" ")} to={sessionPath(session.sessionId)} aria-label={name}>
      <span className="cal-b-top">
        {entry.intent === "reserved" && <Icon name="check" />}
        {entry.hidden && <Icon name="eye-off" />}
        <span className="code">{session.code ?? (entry.intent === "reserved" ? "Reserved" : "Interested")}</span>
        {going && (
          <span className="cal-b-going">
            <Icon name="people" />
            {going.short}
          </span>
        )}
      </span>
      <span className="cal-b-title">{sessionName(session)}</span>
      {place && <span className="cal-b-place">{place}</span>}
      {clash && (
        <>
          <span className="cal-b-flag clash wide-only">{clashLabel(clash)}</span>
          <span className="cal-b-flag clash narrow-only">Clash</span>
        </>
      )}
      {entry.hidden && <span className="cal-b-flag hidden-flag">Hidden from others</span>}
      {crossesMidnight && <span className="cal-b-flag">Runs past midnight</span>}
    </Link>
  );
}

/** "AIM3315, Building agents…, Tuesday 8:30 to 9:30 AM, Venetian, reserved", and the flags after it. */
function blockName(entry: CalendarEntry, span: Span | null, clashing: Map<string, string[]> | undefined, going: GoingNote | undefined): string {
  const { session } = entry;
  const weekday = (date: string) => formatDate(date).split(" ")[0];
  let when = "all day";
  if (span && session.startsAt) {
    const day = weekday(span.date);
    if (!span.endKnown || !session.endsAt) when = `${day} from ${formatTime(session.startsAt)}, end time not announced`;
    else if (span.crossesMidnight) when = `${day} ${formatTime(session.startsAt)} to ${formatTime(session.endsAt)} ${weekday(eventDate(session.endsAt))}, past midnight`;
    else when = `${day} ${formatTimeRange(session.startsAt, session.endsAt)}`;
  } else if (session.startsAt) {
    when = `${weekday(eventDate(session.startsAt))}, all day`;
  }
  const clash = clashing?.get(entry.sessionId);
  return [
    session.code,
    session.title ?? (session.code ? undefined : "Untitled session"),
    when,
    session.venue,
    entry.intent === "reserved" ? "reserved" : "interested",
    clash && clashLabel(clash).toLowerCase(),
    entry.hidden && "hidden from others",
    going?.spoken,
  ]
    .filter(Boolean)
    .join(", ");
}

const place = (top: number, length: number, lane: number, lanes: number) =>
  ({ "--top": top, "--len": length, "--lane": lane, "--lanes": lanes }) as CSSProperties;

const hourMarks = ({ start, end }: { start: number; end: number }) => {
  const marks: number[] = [];
  for (let minute = start; minute < end; minute += 60) marks.push(minute);
  return marks;
};

/** An all-day session is on the date it starts. */
const onDate = (session: Session, date: string) => !!session.startsAt && eventDate(session.startsAt) === date;

const count = (n: number) => (n === 1 ? "1 session" : `${n} sessions`);

function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (changed) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", changed);
      return () => list.removeEventListener("change", changed);
    },
    () => window.matchMedia(query).matches,
  );
}

/** The width of the element given the returned ref, kept current as the window resizes. */
function useWidth(): [number, (element: HTMLElement | null) => void] {
  const [width, setWidth] = useState(320);
  const observer = useRef<ResizeObserver | null>(null);
  const measure = useCallback((element: HTMLElement | null) => {
    observer.current?.disconnect();
    if (!element) return;
    observer.current = new ResizeObserver(([first]) => first && setWidth(first.contentRect.width));
    observer.current.observe(element);
  }, []);
  useEffect(() => () => observer.current?.disconnect(), []);
  return [width, measure];
}

/** The time now, ticking each minute, for the "now" line. */
function useNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}
