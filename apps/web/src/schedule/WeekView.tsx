// List, Calendar or Map: how a week is drawn, on My week and on a person's
// page (issues #91, #93). The URL says it (?view=calendar), so a link opens
// the same view; without one, the viewer's last choice, kept in this browser.
//
// The switch is three joined icon buttons at the right of the day's header
// row, not a full-width control under the title. The owner, 2026-11-13: "The
// 'Calendar or list' option should be a stacked button in the top right
// corner of the section below where you select the days you care about."
import { useSearchParams } from "react-router";
import { Icon, type IconName } from "../shell/Icon.tsx";

export type WeekView = "list" | "calendar" | "map";

const views: readonly { view: WeekView; label: string; icon: IconName }[] = [
  { view: "list", label: "List", icon: "list" },
  { view: "calendar", label: "Calendar", icon: "week" },
  { view: "map", label: "Map", icon: "map" },
];

const storageKey = "hallway.week-view";

const isView = (value: string | null): value is WeekView => views.some(({ view }) => view === value);

function remembered(): WeekView {
  try {
    const kept = localStorage.getItem(storageKey);
    return isView(kept) ? kept : "list";
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
  const view: WeekView = isView(asked) ? asked : remembered();
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
    <div className="week-view" role="group" aria-label="Show the week as">
      {views.map(({ view: option, label, icon }) => (
        <button key={option} type="button" aria-label={label} title={label} aria-pressed={view === option} onClick={() => onChange(option)}>
          <Icon name={icon} />
        </button>
      ))}
    </div>
  );
}
