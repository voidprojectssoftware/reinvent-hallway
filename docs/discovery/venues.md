# re:Invent venues: buildings, outlines and walking times

Measured 2026-11-13 for issue #93 (the campus map). Measure, commit, then
derive: every coordinate, outline and walking time below comes from a query
whose answer is committed beside this file, and the code's copy
(`packages/domain/src/venue-data.ts`) is written from those answers by a
script, never by hand. `scripts/venues/derive.test.mjs` fails when the two
differ.

| Step | Command | Writes |
| --- | --- | --- |
| Measure | `node scripts/venues/measure.mjs` | `docs/discovery/venues/osm-<date>.json`, `docs/discovery/venues/walks-<date>.json` |
| Derive | `node scripts/venues/derive.mjs` | `packages/domain/src/venue-data.ts` (the newest measurement of each kind) |
| Base map | `npm run tiles` | `apps/web/public/tiles/` (git-ignored, ADR 0029) |

Map data © OpenStreetMap contributors, under the
[Open Database License](https://www.openstreetmap.org/copyright). The credit
is in the map's attribution control and in the Venues resource.

## Which venues

The venue list is derived from the `venue` values in synced sessions, as the
issue asks, plus the venue names the issue's own research found for 2026.
The synced sessions here are the two AWS-shaped fixtures the demo data and
the tests use (`apps/api/src/schedule-fixtures/aws-reinvent2026-schedule.json`,
`e2e/fixtures/aws-reinvent2026-schedule-b.json`). Their venue values:

| AWS `venue` | Distinct sessions | Maps to |
| --- | --- | --- |
| `Venetian` | 8 (rooms such as "Venetian Ballroom", "Expo Hall, Level 2", "Level 4, Lando 4201", "Level 5, Palazzo B") | `venetian` |
| `MGM Grand` | 3 | `mgm-grand` |
| `Caesars Forum` | 3 | `caesars-forum` |
| `Mandalay Bay` | 2 | `mandalay-bay` |
| `Wynn` | 1 | `wynn` |
| `Las Vegas Festival Grounds` | 1 (re:Play) | none: listed under "Not on the map" |

`Caesars Palace` and `Encore` appear in no fixture; they are in the table
because the issue's research lists them as 2026 venues, and AWS has used both
names before. A name not in the table is shown as "Not on the map", never
guessed at.

**Las Vegas Festival Grounds is left off on purpose.** It is in OpenStreetMap
(way/117684178, `leisure=festival_grounds`), so it could be mapped. It holds
one evening event, re:Play, which AWS serves by shuttle; a walking time from
a session venue to it would be a number nobody uses. Leaving it off also
keeps one real "Not on the map" case in the demo data, which the screen
needs to show. Adding it is one entry in `venue-list.ts` and a rerun of the
two scripts. A question for the owner, not a finding.

**Rooms are not mapped.** OpenStreetMap's indoor data around the Venetian and
Caesars Forum is doors and a few generic areas, with no named rooms (the
issue's research, 2026-11-13), and the official floor plans are AWS's app and
copyrighted venue PDFs. A session's `room` stays text.

## How a venue string becomes a venue

`venueOf` in `packages/domain/src/venues.ts`, tested in `venues.test.ts`: the
text before the first `|` or `,`, folded to lowercase words (accents and
punctuation dropped, a leading "the" dropped), matched as a whole-word prefix
against each venue's aliases, longest first.

| Venue id | Aliases |
| --- | --- |
| `venetian` | venetian, venetian expo, venetian convention center, sands expo |
| `caesars-forum` | caesars forum |
| `caesars-palace` | caesars palace |
| `wynn` | wynn, wynn las vegas |
| `encore` | encore, encore las vegas, encore at wynn |
| `mgm-grand` | mgm grand, mgm |
| `mandalay-bay` | mandalay bay, mandalay |

So "Venetian | Level 2", "The Venetian" and "VENETIAN EXPO" are `venetian`;
"MGM Grand Conference Center" is `mgm-grand`; "Caesars" alone and
"Wynnsboro" are nothing. "Palazzo" is not an alias: the Palazzo is its own
tower, and the fixtures only use it as a room name inside the Venetian
("Level 5, Palazzo B").

## The buildings (OpenStreetMap, 2026-11-13)

Found first with a name search over the Strip (Overpass,
`nwr["name"~"Venetian|Palazzo|Caesars|Wynn|Encore|MGM Grand|Mandalay|Festival Grounds|Sands Expo",i](36.08,-115.19,36.15,-115.14); out tags center;`),
which returned about 70 named objects. For each venue the building that holds
the sessions was chosen: the conference centre where OSM has one
(`amenity=conference_centre` on a building), else the hotel's own building.
Then measured by id with the query committed in `venues/osm-2026-11-13.json`:

```
[out:json][timeout:60];
(
  way(id:111367819);
  way(id:762169780);
  way(id:115672893);
  way(id:205501268);
  way(id:27910891);
  way(id:27897924);
  way(id:116660354);
);
out tags center geom;
```

The center is the middle of the bounding box Overpass returns for the way
(what its `out center` gives for a way). Overpass leaves `center` out beside
`geom`, so both scripts take it from `bounds`.

| Venue id | Name | OSM element | OSM tags | Center (lat, lon) | Outline points |
| --- | --- | --- | --- | --- | --- |
| `venetian` | Venetian Expo | [way/111367819](https://www.openstreetmap.org/way/111367819) | name="Venetian Expo", building=yes, amenity=conference_centre, tourism=yes | 36.121898, -115.16623 | 26 |
| `caesars-forum` | Caesars Forum | [way/762169780](https://www.openstreetmap.org/way/762169780) | name="Caesars Forum", building=yes, amenity=conference_centre | 36.118937, -115.166189 | 115 |
| `caesars-palace` | Caesars Palace | [way/115672893](https://www.openstreetmap.org/way/115672893) | name="Caesars Palace Hotel and Casino", building=hotel, amenity=casino, tourism=hotel | 36.116625, -115.176653 | 148 |
| `wynn` | Wynn | [way/205501268](https://www.openstreetmap.org/way/205501268) | name="Wynn Las Vegas", building=commercial, tourism=hotel | 36.126651, -115.165631 | 56 |
| `encore` | Encore | [way/27910891](https://www.openstreetmap.org/way/27910891) | name="Encore Las Vegas", building=commercial, tourism=hotel | 36.129456, -115.164726 | 31 |
| `mgm-grand` | MGM Grand Conference Center | [way/27897924](https://www.openstreetmap.org/way/27897924) | name="MGM Grand Conference Center", building=yes, amenity=conference_centre | 36.104554, -115.164814 | 64 |
| `mandalay-bay` | Mandalay Bay Convention Center | [way/116660354](https://www.openstreetmap.org/way/116660354) | name="Mandalay Bay Convention Center", building=yes, amenity=conference_centre | 36.088948, -115.176376 | 68 |

The Venetian Expo's center (36.1219, -115.1662) and the MGM Grand and
Mandalay Bay conference centers' match the issue's own Overpass reading.

## Walking times (OSRM foot profile, 2026-11-13)

**Source:** the OSRM foot profile FOSSGIS e.V. runs for OpenStreetMap at
`https://routing.openstreetmap.de/routed-foot/`, which needs no account and
no key. The Halloween site's router, openrouteservice, needs an API key, so it
was not used (the brief rules out creating accounts or using keys). One
request per ordered pair of centers, 42 in all, one a second, each URL and
answer committed in `venues/walks-2026-11-13.json`, for example:

```
https://routing.openstreetmap.de/routed-foot/route/v1/driving/-115.16623,36.12189765;-115.1661886,36.11893695?overview=false
```

(`driving` is OSRM's fixed path segment; the profile is the server's, foot.)
OSRM's foot profile walks at about 5 km/h on OpenStreetMap footways,
crossings and footbridges. Minutes below are rounded up, as the app shows
them; the data keeps seconds and meters.

| From, to | `venetian` | `caesars-forum` | `caesars-palace` | `wynn` | `encore` | `mgm-grand` | `mandalay-bay` |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `venetian` |  | 12 min, 0.9 km | 34 min, 2.5 km | 22 min, 1.6 km | 24 min, 1.7 km | 32 min, 2.4 km | 71 min, 5.3 km |
| `caesars-forum` | 12 min, 0.9 km |  | 22 min, 1.6 km | 24 min, 1.7 km | 26 min, 1.9 km | 27 min, 2.0 km | 61 min, 4.5 km |
| `caesars-palace` | 34 min, 2.5 km | 22 min, 1.6 km |  | 34 min, 2.5 km | 36 min, 2.7 km | 41 min, 3.0 km | 59 min, 4.4 km |
| `wynn` | 22 min, 1.6 km | 24 min, 1.7 km | 34 min, 2.5 km |  | 9 min, 0.6 km | 44 min, 3.3 km | 75 min, 5.6 km |
| `encore` | 24 min, 1.7 km | 26 min, 1.9 km | 36 min, 2.7 km | 9 min, 0.6 km |  | 46 min, 3.4 km | 77 min, 5.7 km |
| `mgm-grand` | 32 min, 2.4 km | 27 min, 2.0 km | 41 min, 3.0 km | 44 min, 3.3 km | 46 min, 3.4 km |  | 39 min, 2.9 km |
| `mandalay-bay` | 71 min, 5.3 km | 61 min, 4.5 km | 59 min, 4.4 km | 75 min, 5.6 km | 77 min, 5.7 km | 39 min, 2.9 km |  |

What the numbers are and are not:

- **Center to center.** OSRM snaps each center to the nearest footway (8 to
  98 m away; the snap distances are in the committed answers). The walk
  inside a venue to the room is not counted, and in the Venetian Expo or
  Mandalay Bay that can be ten minutes on its own. The app says so under the
  map, and treats a walk equal to the gap as not tight, so its warning is a
  floor.
- **Caesars Palace runs long.** Its center snaps into the Caesars Palace
  Self Parking footways, so its routes start with a detour through the
  garage: Venetian to Caesars Palace is 2.5 km where the straight line is
  about 1.1 km. No fixture session is there; if 2026 sessions are, picking a
  better routing point (an entrance node from OSM) is the fix.
- **Not the shuttles.** AWS's own page
  (https://aws.amazon.com/resources/analyst-summit, read by the issue's
  research on 2026-11-13) says campus shuttles connect most venues, but not
  Wynn and the Venetian (a bridge, on foot) and not Caesars Forum and the
  Venetian (a temporary walkway, open during Expo hours only). The app does
  not time shuttles; its footnote says they run. A Mandalay Bay to Wynn hop
  is a shuttle ride, not a 75-minute walk.

## What changes when

- A new venue string in real synced data that should map: add an alias (or a
  venue) in `packages/domain/src/venue-list.ts` with a test case in
  `venues.test.ts`; a new venue needs `measure.mjs` and `derive.mjs` rerun.
- OpenStreetMap or the router changes: rerun both scripts; the new dated
  files sit beside the old ones and `derive.mjs` takes the newest.
