// The day picker (docs/design/my-week.html): the event's days as chips
// sharing the row's width. The chosen day is in the URL (?day=2026-12-01),
// shared by the list, the calendar and the map, so switching views keeps it.
//
// The chips stay pinned under the nav bar while the day scrolls (.days in
// app.css, #114), so another day is one tap away from anywhere in a long one.
import { useSearchParams } from "react-router";
import { dayChip, eventDate, formatDate } from "../time.ts";

export function DayChips({ dates, chosen }: { dates: readonly string[]; chosen: string }) {
  const [, setSearch] = useSearchParams();
  const today = eventDate(new Date());
  return (
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
            onClick={(event) => {
              setSearch(
                (current) => {
                  const params = new URLSearchParams(current);
                  params.set("day", date);
                  params.delete("at");
                  return params;
                },
                { replace: true },
              );
              startOfDay(event.currentTarget.parentElement);
            }}
          >
            <small>{weekday}</small>
            <b>{day}</b>
          </button>
        );
      })}
    </div>
  );
}

/**
 * A day picked from the pinned chips opens at its start, just under them,
 * not at whatever depth the last day was scrolled to. Above that point (the
 * chips not yet pinned) the page stays where it is.
 */
function startOfDay(chips: HTMLElement | null) {
  if (!chips) return;
  // Where the chips sit unpinned: just under what comes before them.
  const above = chips.previousElementSibling ?? chips.parentElement;
  if (!above) return;
  const resting = above.getBoundingClientRect()[above === chips.parentElement ? "top" : "bottom"] + window.scrollY;
  const top = resting - parseFloat(getComputedStyle(chips).top);
  if (window.scrollY > top) window.scrollTo({ top });
}

/**
 * The line above a day's sessions, beside the view switch: the count only,
 * since the pressed chip already says the day (#114). A screen reader hears
 * the day too, as it does not see which chip is pressed from here.
 */
export function DayCount({ date, count }: { date: string; count: number }) {
  return (
    <h2 className="ghead day-count">
      <span className="vh">{formatDate(date)}: </span>
      {count === 1 ? "1 session" : `${count} sessions`}
    </h2>
  );
}

/** The day asked for, else today during the event, else the first day with something on it. */
export function pickDate(asked: string | null, dates: readonly string[], busy: (date: string) => boolean): string {
  if (asked && dates.includes(asked)) return asked;
  const today = eventDate(new Date());
  if (dates.includes(today)) return today;
  return dates.find(busy) ?? dates[0] ?? today;
}
