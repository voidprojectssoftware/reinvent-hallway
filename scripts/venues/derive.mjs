// `node scripts/venues/derive.mjs`: writes packages/domain/src/venue-data.ts
// from the newest answers measure.mjs committed under docs/discovery/venues/
// (issue #93). Measure, commit, then derive: nothing in venue-data.ts is typed
// by hand, and derive.test.mjs fails when it differs from what this writes.
//
// Kept from the answers: each venue's outline and center (the middle of the
// bounding box Overpass gave, the point the walks were routed from), to six
// decimals (about 0.1 m), and each walk's distance and duration as OSRM gave
// them, rounded to the meter and the second.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { venueList } from "../../packages/domain/src/venue-list.ts";

const discovery = new URL("../../docs/discovery/venues/", import.meta.url);
const target = new URL("../../packages/domain/src/venue-data.ts", import.meta.url);

const newest = (prefix) => {
  const name = readdirSync(discovery)
    .filter((file) => file.startsWith(prefix) && file.endsWith(".json"))
    .sort()
    .at(-1);
  if (!name) throw new Error(`no ${prefix}*.json in docs/discovery/venues/`);
  return { name, data: JSON.parse(readFileSync(new URL(name, discovery), "utf8")) };
};

const at6 = (n) => Math.round(n * 1e6) / 1e6;

/** The text of venue-data.ts. */
export function deriveVenueData() {
  const osm = newest("osm-");
  const walks = newest("walks-");
  const venues = venueList.map((venue) => {
    const element = osm.data.answer.elements.find((e) => e.type === venue.osm.type && e.id === venue.osm.id);
    if (!element) throw new Error(`${venue.venueId}: ${venue.osm.type}/${venue.osm.id} not in ${osm.name}`);
    const { minlat, minlon, maxlat, maxlon } = element.bounds;
    return {
      venueId: venue.venueId,
      center: [at6((minlat + maxlat) / 2), at6((minlon + maxlon) / 2)],
      outline: element.geometry.map(({ lat, lon }) => [at6(lat), at6(lon)]),
    };
  });
  const legs = walks.data.walks.map(({ from, to, answer }) => ({
    from,
    to,
    meters: Math.round(answer.routes[0].distance),
    seconds: Math.round(answer.routes[0].duration),
  }));
  const data = { measuredOn: osm.data.measuredOn, walksMeasuredOn: walks.data.measuredOn, venues, walks: legs };
  return `// Written by scripts/venues/derive.mjs from docs/discovery/venues/${osm.name}
// and ${walks.name}. Do not edit: change the measurements and derive again.
// Outlines © OpenStreetMap contributors (ODbL). Walks: OSRM foot profile on
// routing.openstreetmap.de (FOSSGIS e.V.), on OpenStreetMap data.
export const venueData = ${JSON.stringify(data)} as const;
`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  writeFileSync(target, deriveVenueData());
  console.log(`wrote ${fileURLToPath(target)}`);
}
