// List or Calendar: how a week is drawn, on My week and on a person's page
// (issue #91). The URL says it (?view=calendar), so a link opens the same
// view; without one, the viewer's last choice, kept in this browser.
import { useSearchParams } from "react-router";

export type WeekView = "list" | "calendar";

const storageKey = "hallway.week-view";

function remembered(): WeekView {
  try {
    return localStorage.getItem(storageKey) === "calendar" ? "calendar" : "list";
  } catch {
    // Storage refused (a private window, blocked site data): the list.
    return "list";
  }
}

function remember(view: WeekView) {
  try {
    localStorage.setItem(storageKey, view);
  } catch {
    // Nothing to keep it in; the URL still carries it.
  }
}

/** The view shown, and a way to change it that keeps the day and drops a "+N more" slot. */
export function useWeekView(): [WeekView, (view: WeekView) => void] {
  const [search, setSearch] = useSearchParams();
  const asked = search.get("view");
  const view: WeekView = asked === "calendar" || asked === "list" ? asked : remembered();
  const choose = (next: WeekView) => {
    remember(next);
    setSearch(
      (current) => {
        const params = new URLSearchParams(current);
        params.set("view", next);
        params.delete("at");
        return params;
      },
      { replace: true },
    );
  };
  return [view, choose];
}

export function WeekViewToggle({ view, onChange }: { view: WeekView; onChange: (view: WeekView) => void }) {
  return (
    <div className="seg week-view" role="group" aria-label="Show the week as">
      <button type="button" aria-pressed={view === "list"} onClick={() => onChange("list")}>
        List
      </button>
      <button type="button" aria-pressed={view === "calendar"} onClick={() => onChange("calendar")}>
        Calendar
      </button>
    </div>
  );
}
