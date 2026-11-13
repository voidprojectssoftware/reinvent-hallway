// `node scripts/venues/measure.mjs`: measures the venues in
// packages/domain/src/venue-list.ts and commits the raw answers (issue #93).
// Run by hand when a venue is added or the data should be refreshed; then run
// `node scripts/venues/derive.mjs`. Nothing at build or run time reaches the
// network.
//
// 1. OpenStreetMap, through the public Overpass API: each venue's building
//    by its OSM id, with its tags, outline and bounding box.
//    Written to docs/discovery/venues/osm-<date>.json with the query.
//    Data © OpenStreetMap contributors, ODbL.
// 2. Walking routes between every ordered pair of centers, from the OSRM
//    foot profile FOSSGIS runs for OpenStreetMap at routing.openstreetmap.de.
//    No account and no key. One request a second, 42 requests in all.
//    Written to docs/discovery/venues/walks-<date>.json with each request URL.
//
// Every request names this project in its User-Agent, as both services ask.
import { mkdirSync, writeFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { venueList } from "../../packages/domain/src/venue-list.ts";

const out = new URL("../../docs/discovery/venues/", import.meta.url);
const date = new Date().toISOString().slice(0, 10);
const userAgent = "reinvent-hallway venue discovery (github.com/voidprojectssoftware)";

const overpass = "https://overpass-api.de/api/interpreter";
const query = `[out:json][timeout:60];
(
${venueList.map((venue) => `  ${venue.osm.type}(id:${venue.osm.id});`).join("\n")}
);
out tags center geom;`;

// The public server answers 502 or 429 when busy and asks for backoff.
let osmResponse;
for (let wait = 5000; ; wait *= 2) {
  osmResponse = await fetch(overpass, {
    method: "POST",
    headers: { "user-agent": userAgent, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ data: query }),
  });
  if (osmResponse.ok || ![429, 502, 503, 504].includes(osmResponse.status) || wait > 80000) break;
  console.log(`Overpass busy (${osmResponse.status}), retrying in ${wait / 1000} s`);
  await sleep(wait);
}
if (!osmResponse.ok) throw new Error(`Overpass: ${osmResponse.status} ${await osmResponse.text()}`);
const osm = await osmResponse.json();

const centers = new Map();
for (const venue of venueList) {
  const element = osm.elements.find((e) => e.type === venue.osm.type && e.id === venue.osm.id);
  if (!element) throw new Error(`${venue.venueId}: ${venue.osm.type}/${venue.osm.id} not in the Overpass answer`);
  // The middle of the bounding box Overpass returns: what Overpass's own
  // `out center` gives for a way, which it leaves out beside `geom`.
  const { minlat, minlon, maxlat, maxlon } = element.bounds;
  centers.set(venue.venueId, { lat: (minlat + maxlat) / 2, lon: (minlon + maxlon) / 2 });
}

mkdirSync(out, { recursive: true });
writeFileSync(
  new URL(`osm-${date}.json`, out),
  `${JSON.stringify({ measuredOn: date, source: overpass, license: "ODbL, © OpenStreetMap contributors", query, answer: osm }, null, 2)}\n`,
);
console.log(`osm-${date}.json: ${osm.elements.length} elements`);

const router = "https://routing.openstreetmap.de/routed-foot/route/v1/driving";
const walks = [];
for (const from of venueList) {
  for (const to of venueList) {
    if (from === to) continue;
    const a = centers.get(from.venueId);
    const b = centers.get(to.venueId);
    const url = `${router}/${a.lon},${a.lat};${b.lon},${b.lat}?overview=false`;
    const response = await fetch(url, { headers: { "user-agent": userAgent } });
    if (!response.ok) throw new Error(`${url}: ${response.status}`);
    const answer = await response.json();
    if (answer.code !== "Ok") throw new Error(`${url}: ${answer.code}`);
    walks.push({ from: from.venueId, to: to.venueId, url, answer });
    console.log(`${from.venueId} -> ${to.venueId}: ${Math.round(answer.routes[0].distance)} m, ${Math.round(answer.routes[0].duration / 60)} min`);
    await sleep(1000);
  }
}
writeFileSync(
  new URL(`walks-${date}.json`, out),
  `${JSON.stringify({ measuredOn: date, source: "OSRM foot profile, routing.openstreetmap.de (FOSSGIS e.V.), on OpenStreetMap data", walks }, null, 2)}\n`,
);
console.log(`walks-${date}.json: ${walks.length} routes`);
