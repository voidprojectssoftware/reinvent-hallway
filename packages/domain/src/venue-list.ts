// The re:Invent venues Hallway can place on a map (issue #93), and the names
// AWS writes for each. Hand-written; everything measured about them (outline,
// centroid, walking times) is in venue-data.ts, which
// scripts/venues/derive.mjs writes from the OpenStreetMap and routing answers
// committed under docs/discovery/venues/. Measured by
// scripts/venues/measure.mjs, which reads the OSM ids here.
//
// No imports, so the measuring script can load this file as it is.
//
// An alias is matched against the venue text's first part (before "|" or ","),
// folded to lowercase words, as a whole-word prefix: "mgm grand" takes
// "MGM Grand Conference Center". "Caesars" alone matches nothing, because two
// venues start with it.

export const venueList = [
  {
    venueId: "venetian",
    name: "Venetian Expo",
    osm: { type: "way", id: 111367819 },
    aliases: ["venetian", "venetian expo", "venetian convention center", "sands expo"],
  },
  {
    venueId: "caesars-forum",
    name: "Caesars Forum",
    osm: { type: "way", id: 762169780 },
    aliases: ["caesars forum"],
  },
  {
    venueId: "caesars-palace",
    name: "Caesars Palace",
    osm: { type: "way", id: 115672893 },
    aliases: ["caesars palace"],
  },
  {
    venueId: "wynn",
    name: "Wynn",
    osm: { type: "way", id: 205501268 },
    aliases: ["wynn", "wynn las vegas"],
  },
  {
    venueId: "encore",
    name: "Encore",
    osm: { type: "way", id: 27910891 },
    aliases: ["encore", "encore las vegas", "encore at wynn"],
  },
  {
    venueId: "mgm-grand",
    name: "MGM Grand Conference Center",
    osm: { type: "way", id: 27897924 },
    aliases: ["mgm grand", "mgm"],
  },
  {
    venueId: "mandalay-bay",
    name: "Mandalay Bay Convention Center",
    osm: { type: "way", id: 116660354 },
    aliases: ["mandalay bay", "mandalay"],
  },
] as const;

export type VenueId = (typeof venueList)[number]["venueId"];
