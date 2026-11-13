// The Venues resource (issue #93): where an event's sessions can be placed on
// a map, and how long the walk is between two of them. Public facts, measured
// from OpenStreetMap and an open router (docs/discovery/venues.md).
import { z } from "zod";
import { EventId } from "./event.ts";

const LatLng = z
  .tuple([z.number(), z.number()])
  .meta({ description: "[latitude, longitude], WGS 84.", example: [36.121929, -115.16623] });

export const VenueId = z.string().meta({
  description: "Hallway's id for a venue, e.g. `venetian`. A session's `venueId` names one; a session without one is not on the map.",
  example: "venetian",
});

export const Venue = z
  .object({
    venueId: VenueId,
    name: z.string().meta({ example: "Venetian Expo" }),
    osm: z
      .object({ type: z.enum(["way", "node", "relation"]), id: z.int() })
      .meta({ description: "The OpenStreetMap element its outline comes from." }),
    center: LatLng.meta({ description: "The middle of the outline's bounding box; walks are measured from here." }),
    outline: z.array(LatLng).meta({ description: "The building's outline, closed (the first point is repeated last)." }),
  })
  .meta({ id: "Venue", description: "A building re:Invent sessions are held in." });
export type Venue = z.infer<typeof Venue>;

export const Walk = z
  .object({
    from: VenueId,
    to: VenueId,
    meters: z.int().min(0),
    minutes: z.int().min(0).meta({ description: "Walking time, rounded up to the minute." }),
  })
  .meta({
    id: "Walk",
    description:
      "Walking from one venue's center to another's on OpenStreetMap footways, as an open router measured it. Walking inside a venue to the room is not in it.",
  });
export type Walk = z.infer<typeof Walk>;

export const Venues = z
  .object({
    eventId: EventId,
    venues: z.array(Venue),
    walks: z.array(Walk).meta({ description: "One each way for every two venues." }),
    measuredOn: z
      .object({ venues: z.iso.date(), walks: z.iso.date() })
      .meta({ description: "When the outlines and the walks were measured." }),
    attribution: z.string().meta({ description: "Credit to show wherever the data is shown." }),
  })
  .meta({ id: "Venues", description: "The venues of an event Hallway can map, and the walks between them." });
export type Venues = z.infer<typeof Venues>;
