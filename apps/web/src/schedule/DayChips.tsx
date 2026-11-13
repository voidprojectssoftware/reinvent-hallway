// The day picker (docs/design/my-week.html): the event's days as chips
// sharing the row's width. The chosen day is in the URL (?day=2026-12-01),
// shared by the list and the calendar, so switching views keeps it.
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
            onClick={() =>
              setSearch(
                (current) => {
                  const params = new URLSearchParams(current);
                  params.set("day", date);
                  params.delete("at");
                  return params;
                },
                { replace: true },
              )
            }
          >
            <small>{weekday}</small>
            <b>{day}</b>
          </button>
        );
      })}
    </div>
  );
}

/** The day asked for, else today during the event, else the first day with something on it. */
export function pickDate(asked: string | null, dates: readonly string[], busy: (date: string) => boolean): string {
  if (asked && dates.includes(asked)) return asked;
  const today = eventDate(new Date());
  if (dates.includes(today)) return today;
  return dates.find(busy) ?? dates[0] ?? today;
}
