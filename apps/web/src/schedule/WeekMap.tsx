// The Map view of a week (issue #93), loaded only when it opens: Leaflet, the
// tile renderer and the venue data are a separate chunk (map/MapView.tsx), so
// the list and the calendar never download them.
import { lazy, Suspense } from "react";
import type { MapViewProps } from "../map/MapView.tsx";
import type { CalendarEntry } from "./WeekCalendar.tsx";

const MapView = lazy(() => import("../map/MapView.tsx"));

export function WeekMap<E extends CalendarEntry>(props: MapViewProps<E>) {
  return (
    <Suspense fallback={<p className="gfoot">Loading the map…</p>}>
      {/* lazy() drops the type parameter; the props are the same component's. */}
      <MapView {...(props as unknown as MapViewProps<CalendarEntry>)} />
    </Suspense>
  );
}
