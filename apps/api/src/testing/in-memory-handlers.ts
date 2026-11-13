// Every handler over the in-memory fakes, wired as index.ts wires them over
// D1: one attendee store, one schedule store, and the network fake's answer
// to "are these two connected" given to identity, sharing and session search.
// The API tests build their app from this, so a slice adding a handler adds
// it in one place for all of them.
import {
  connectionsGoing,
  getEvent,
  identityHandlers,
  invitePathOf,
  networkHandlers,
  scheduleHandlers,
  sharingHandlers,
  type AreConnected,
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

/** For tests that do not look at the share card: an empty PNG. */
export const noPng = async () => new Uint8Array();

export function inMemoryHandlers(
  options: { now?: () => Date; identity?: Partial<IdentityPorts> } = {},
) {
  const now = options.now ?? (() => new Date());
  const events = eventsInMemory([reinvent2026]);
  const attendees = attendeesInMemory();
  const schedule = scheduleInMemory();
  const network = networkInMemory({ attendees, schedule });
  const areConnected: AreConnected = (a, b) => network.areConnected(a, b);
  const identityPorts = identityInMemory({ attendees, areConnected, now, ...options.identity });
  const handlers: Handlers = {
    getEvent: getEvent(events),
    identity: identityHandlers(identityPorts),
    ...scheduleHandlers({
      events,
      schedule,
      sessionUrlTemplate: testSessionUrlTemplate,
      now,
      connectionsGoing: connectionsGoing(network),
    }),
    network: networkHandlers({ attendees, network, events, schedule, sessionUrlTemplate: testSessionUrlTemplate, now }),
    sharing: sharingHandlers({
      attendees,
      calendarFeeds: identityPorts.calendarFeeds,
      events,
      schedule,
      areConnected,
      sessionUrlTemplate: testSessionUrlTemplate,
      invitePath: invitePathOf(network, now),
    }),
  };
  return { handlers, attendees, schedule, network };
}
