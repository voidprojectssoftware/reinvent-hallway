// GetVenues (issue #93): the venues the domain can place a session in, and the
// measured walks between them. `GET /api/events/{eventId}/venues` and the MCP
// tool `get_venues` both call this. Public facts, so every actor may read them.
import type { GetEventInput, Venues } from "@hallway/contracts";
import { venues, venuesMeasuredOn, walks } from "@hallway/domain";
import type { Actor } from "../actor.ts";
import { ok, type Outcome } from "../outcome.ts";
import type { EventRepository } from "./event-repository.ts";
import { noEvent } from "./get-event.ts";

export type GetVenues = (actor: Actor, input: GetEventInput) => Promise<Outcome<Venues>>;

export const venuesAttribution =
  "Map data © OpenStreetMap contributors (ODbL). Walking times: OSRM on routing.openstreetmap.de (FOSSGIS e.V.).";

export function getVenues(events: EventRepository): GetVenues {
  return async (_actor, { eventId }) => {
    if (!(await events.get(eventId))) return noEvent(eventId);
    return ok({
      eventId,
      venues: venues.map((venue) => ({
        venueId: venue.venueId,
        name: venue.name,
        osm: venue.osm,
        center: [...venue.center],
        outline: venue.outline.map(([lat, lon]) => [lat, lon]),
      })),
      walks: walks.map(({ from, to, meters, minutes }) => ({ from, to, meters, minutes })),
      measuredOn: venuesMeasuredOn,
      attribution: venuesAttribution,
    });
  };
}
