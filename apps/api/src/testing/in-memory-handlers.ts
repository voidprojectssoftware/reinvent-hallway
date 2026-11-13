// Every handler over the in-memory fakes, wired as index.ts wires them over
// D1: one attendee store, one schedule store, and the network fake's answer
// to "are these two connected" given to identity and to session search. The
// API tests build their app from this, so a slice adding a handler adds it in
// one place for all of them.
import {
  connectionsGoing,
  getEvent,
  identityHandlers,
  networkHandlers,
  scheduleHandlers,
  type IdentityPorts,
} from "@hallway/application";
import {
  attendeesInMemory,
  eventsInMemory,
  identityInMemory,
  networkInMemory,
  reinvent2026,
  scheduleInMemory,
} from "@hallway/infrastructure";
import type { Handlers } from "../app.ts";

export const testSessionUrlTemplate = "https://example.test/catalog?search={code}";

export function inMemoryHandlers(
  options: { now?: () => Date; identity?: Partial<IdentityPorts> } = {},
) {
  const now = options.now ?? (() => new Date());
  const events = eventsInMemory([reinvent2026]);
  const attendees = attendeesInMemory();
  const schedule = scheduleInMemory();
  const network = networkInMemory({ attendees, schedule });
  const handlers: Handlers = {
    getEvent: getEvent(events),
    identity: identityHandlers(
      identityInMemory({ attendees, areConnected: (a, b) => network.areConnected(a, b), now, ...options.identity }),
    ),
    ...scheduleHandlers({
      events,
      schedule,
      sessionUrlTemplate: testSessionUrlTemplate,
      now,
      connectionsGoing: connectionsGoing(network),
    }),
    network: networkHandlers({ attendees, network, events, schedule, sessionUrlTemplate: testSessionUrlTemplate, now }),
  };
  return { handlers, attendees, schedule, network };
}
