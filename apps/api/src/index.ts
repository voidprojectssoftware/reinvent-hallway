// The Worker's composition root (ADR 0002): the one place adapters are chosen.
// Each request gets its handlers over D1 from its own bindings.
import { connectionsGoing, getEvent, identityHandlers, networkHandlers, scheduleHandlers } from "@hallway/application";
import {
  agentTokensOnD1,
  attendeesOnD1,
  calendarFeedsOnD1,
  eventsOnD1,
  linkedInOidc,
  networkOnD1,
  openDatabase,
  scheduleOnD1,
  webSessionsOnD1,
} from "@hallway/infrastructure";
import { createApp } from "./app.ts";
import { isPersonPage, personPage } from "./person-page.ts";

const app = createApp<Env>({
  handlers: (env) => {
    const db = openDatabase(env.DB);
    const events = eventsOnD1(db);
    const attendees = attendeesOnD1(db);
    const schedule = scheduleOnD1(db);
    const network = networkOnD1(db);
    const now = () => new Date();
    return {
      getEvent: getEvent(events),
      identity: identityHandlers({
        attendees,
        agentTokens: agentTokensOnD1(db),
        webSessions: webSessionsOnD1(db),
        calendarFeeds: calendarFeedsOnD1(db),
        // The one answer to "are these two connected" for every read path
        // that asks the visibility rule (the attendee card among them).
        areConnected: (a, b) => network.areConnected(a, b),
        // LinkedIn sign-in is off until the owner's LinkedIn app supplies these.
        linkedIn:
          env.LINKEDIN_CLIENT_ID && env.LINKEDIN_CLIENT_SECRET
            ? linkedInOidc({ clientId: env.LINKEDIN_CLIENT_ID, clientSecret: env.LINKEDIN_CLIENT_SECRET })
            : undefined,
      }),
      ...scheduleHandlers({
        events,
        schedule,
        sessionUrlTemplate: env.SESSION_URL_TEMPLATE,
        now,
        connectionsGoing: connectionsGoing(network),
      }),
      network: networkHandlers({
        attendees,
        network,
        events,
        schedule,
        sessionUrlTemplate: env.SESSION_URL_TEMPLATE,
        now,
      }),
    };
  },
});

export default {
  fetch(request, env, ctx) {
    const url = new URL(request.url);
    return isPersonPage(url) ? personPage(url, env.ASSETS) : app.fetch(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;
