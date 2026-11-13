// The Leaflet map of one day (issue #93): every venue's OpenStreetMap
// outline, the day's venues filled, a pin on each carrying the numbers of
// its sessions in the day's order (the same numbers as the list beside the
// map) and a count when several share it, and the path between them with
// each walk's minutes on it (orange and marked "tight" when the gap is
// shorter). Venue names show on the tapped pin and from zoom 16, where they
// no longer cover each other; the list beside the map always names them.
//
// A pin is a keyboard-focusable button (Leaflet marks it so, and Enter clicks
// it) named for the venue and its sessions. The page lists the same day as
// text beside the map, so nothing here is the only way to read it.
import * as L from "leaflet";
import type { Venues } from "@hallway/contracts";
import { useEffect, useRef, useState } from "react";
import type { CalendarEntry } from "../schedule/WeekCalendar.tsx";
import { addBaseLayer, restyleBase, type BaseLayer } from "./basemap.ts";
import { campus } from "./campus.ts";
import { formatMinutes, type DayPath } from "./day-path.ts";

interface CampusMapProps {
  venues: Venues;
  path: DayPath<CalendarEntry>;
  selected: string | null;
  onSelect: (venueId: string) => void;
}

const token = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const escape = (text: string) => text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export function CampusMap({ venues, path, selected, onSelect }: CampusMapProps) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const base = useRef<BaseLayer | null>(null);
  const overlay = useRef<L.LayerGroup | null>(null);
  const select = useRef(onSelect);
  select.current = onSelect;
  const [zoom, setZoom] = useState(0);

  useEffect(() => {
    if (!box.current) return;
    const m = L.map(box.current, {
      minZoom: 13,
      maxZoom: 18,
      maxBounds: L.latLngBounds(campus).pad(0.1),
      // Whole zooms only: a fractional zoom scales the canvas tiles and draws
      // a hairline seam between them.
      zoomSnap: 1,
      attributionControl: true,
    });
    m.attributionControl.setPrefix(false);
    m.attributionControl.addAttribution("Walks: OSRM on OpenStreetMap (FOSSGIS)");
    m.fitBounds(campus);
    base.current = addBaseLayer(m);
    overlay.current = L.layerGroup().addTo(m);
    map.current = m;
    const zoomed = () => {
      box.current?.classList.toggle("named", m.getZoom() >= 16);
      setZoom(m.getZoom());
    };
    m.on("zoomend", zoomed);
    zoomed();
    const dark = window.matchMedia("(prefers-color-scheme: dark)");
    const repaint = () => base.current && restyleBase(base.current);
    dark.addEventListener("change", repaint);
    return () => {
      dark.removeEventListener("change", repaint);
      m.remove();
      map.current = null;
    };
  }, []);

  const fitKey = `${path.stops.map((s) => s.entry.sessionId).join()}|${path.allDay.map((e) => e.sessionId).join()}`;

  useEffect(() => {
    const m = map.current;
    const layer = overlay.current;
    if (!m || !layer) return;
    layer.clearLayers();
    const tint = token("--tint");
    const quiet = token("--label2");
    const warn = token("--orange");
    const onDay = new Set(path.pins.map((pin) => pin.venueId));
    const venue = (venueId: string | undefined) => venues.venues.find((v) => v.venueId === venueId);

    for (const v of venues.venues) {
      const shown = onDay.has(v.venueId);
      L.polygon(v.outline as L.LatLngTuple[], {
        color: shown ? tint : quiet,
        weight: shown ? 2 : 1,
        opacity: shown ? 1 : 0.6,
        fillColor: tint,
        fillOpacity: v.venueId === selected ? 0.35 : shown ? 0.18 : 0,
        interactive: false,
      }).addTo(layer);
    }

    // The path: one segment per walk between two different, mapped venues.
    for (const leg of path.legs) {
      if (leg.walk.kind !== "walk") continue;
      const a = venue(leg.from.entry.session.venueId);
      const b = venue(leg.to.entry.session.venueId);
      if (!a || !b) continue;
      const line = [a.center, b.center] as L.LatLngTuple[];
      L.polyline(line, { color: leg.tight ? warn : tint, weight: 4, opacity: 0.9, dashArray: "2 8", lineCap: "round", interactive: false }).addTo(layer);
      // Between two pins too close to fit a label, the minutes would sit
      // under the pins; the list beside the map has them, and zooming in
      // brings them back.
      if (m.latLngToContainerPoint(line[0]!).distanceTo(m.latLngToContainerPoint(line[1]!)) < 110) continue;
      const middle: L.LatLngTuple = [(a.center[0] + b.center[0]) / 2, (a.center[1] + b.center[1]) / 2];
      const label = `${formatMinutes(leg.walk.minutes)}${leg.tight ? ", tight" : ""}`;
      L.marker(middle, {
        icon: L.divIcon({ className: leg.tight ? "walk-chip tight" : "walk-chip", html: escape(label), iconSize: undefined }),
        interactive: false,
        keyboard: false,
      }).addTo(layer);
    }

    for (const pin of path.pins) {
      const v = venue(pin.venueId);
      if (!v) continue;
      const count = pin.entries.length;
      const order = pin.numbers.length > 0 ? pin.numbers.join(", ") : "All day";
      const spoken = `${v.name}: ${count === 1 ? "1 session" : `${count} sessions`} this day${pin.numbers.length > 0 ? `, number ${pin.numbers.join(" and ")} in the day's order` : ", all day"}`;
      const marker = L.marker(v.center as L.LatLngTuple, {
        icon: L.divIcon({
          className: pin.venueId === selected ? "venue-pin selected" : "venue-pin",
          html: `<span class="pin-order">${escape(order)}${count > 1 ? `<span class="pin-count">${count}</span>` : ""}</span><span class="pin-name">${escape(shortName(v.name))}</span>`,
          iconSize: undefined,
        }),
        title: spoken,
        riseOnHover: true,
        zIndexOffset: 1000,
      }).addTo(layer);
      marker.on("click", () => select.current(pin.venueId));
      const element = marker.getElement();
      element?.setAttribute("role", "button");
      element?.setAttribute("aria-label", spoken);
      // Leaflet makes the pin focusable but Enter does not click it, so a
      // button's keys are wired here.
      element?.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        select.current(pin.venueId);
      });
    }
  }, [venues, path, selected, zoom]);

  // Fit the day's venues when the day changes, not when a pin is tapped.
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const shown = venues.venues.filter((v) => path.pins.some((pin) => pin.venueId === v.venueId));
    const points = (shown.length > 0 ? shown : venues.venues).flatMap((v) => v.outline as L.LatLngTuple[]);
    if (points.length > 0) m.fitBounds(L.latLngBounds(points), { padding: [36, 36], maxZoom: 16 });
    // fitKey, not path: a new path object comes with every render.
  }, [fitKey, venues]);

  return <div ref={box} className="campus-map" aria-label="Map of the day's venues" role="region" />;
}

/** "MGM Grand Conference Center" -> "MGM Grand": the pin's label is short; the spoken name is whole. */
function shortName(name: string): string {
  return name.replace(/ (Conference|Convention) Center$/, "").replace(/ Expo$/, "");
}
