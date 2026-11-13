# 0029. The campus map: measured venues in the domain, self-hosted tiles

Date: 2026-11-13. Status: accepted.

Issue #93 puts a day's sessions on a map of the re:Invent venues and says
whether there is time to walk between them. It brings three new things: data
measured from outside sources, a map library, and map tiles.

**Decision.**

- **Venues are domain facts, measured once and committed.** The venue list
  and the names AWS writes for each are hand-written
  (`packages/domain/src/venue-list.ts`). Outlines, centers and walking times
  are measured by `scripts/venues/measure.mjs` (OpenStreetMap through
  Overpass, walks through the keyless OSRM foot router FOSSGIS runs), the raw
  answers committed under `docs/discovery/venues/`, and
  `packages/domain/src/venue-data.ts` derived from them by
  `scripts/venues/derive.mjs`. `derive.test.mjs` (in `npm run verify`) fails
  when the derived file is edited by hand or falls behind the measurements.
  `docs/discovery/venues.md` has the queries, dates and caveats.
- **The domain names a session's venue** (`venueOf`, a whole-word prefix
  match on folded text), and the Session resource carries the result as
  `venueId`, set where `url` is. The venues and walks reach clients as one
  public resource, `GET /api/events/{eventId}/venues` and the MCP tool
  `get_venues`, so the web app (which may import only the contracts) and an
  agent read the same numbers.
- **Whether a walk fits is worked out in the web app**
  (`apps/web/src/map/day-path.ts`), from my own entries and that resource, as
  clashes are (`clash.ts`): it is a fact about one list the screen holds.
- **Leaflet 1.9.4 and protomaps-leaflet 5.1.0 draw the map**, as on the
  Halloween weekend map (its ADR 0006), in a chunk loaded only when the Map
  view opens (`schedule/WeekMap.tsx`, `React.lazy`). The list and calendar
  bundles do not change.
- **Tiles are self-hosted static files, cut by a script and git-ignored.**
  `npm run tiles` (`scripts/venues/cut-tiles.mjs`, adapted from Halloween's
  `make-basemap-tiles.mjs`) reads the Strip, zooms 12 to 15, out of a pinned
  Protomaps planet build by range requests and writes
  `apps/web/public/tiles/{z}/{x}/{y}.mvt`, keeping only earth, water,
  landuse, roads and buildings: 103 files, about 3.4 MiB. Vite copies them
  into `dist/`, and the Worker serves them as static assets, so no tile
  service sees who looks at the map and no key is needed. Without them (a
  fresh checkout, CI) the map draws the venues, the path and the pins on the
  plain land color.

**Why git-ignored, when Halloween committed its tiles.** The brief for #93
asked for a generated artifact that needs a download to stay out of git, with
the step as a script. The cost: a deploy must run `npm run tiles` first, or
the map has no streets. If the owner would rather have them committed (3.4
MiB, refreshed by a PR), that is deleting one `.gitignore` line.

**Rejected.** openrouteservice for walks (Halloween's ADR 0008): it needs an
API key and an account. Straight-line estimates: the brief asks for a real
router, and the Strip's footbridges make straight lines wrong by minutes.
Serving one `.pmtiles` archive and reading it by range in the browser: one
file and no script output tree, but a second client library and range
requests the static assets layer would have to honour. A hosted tile service:
it sees every viewer.
