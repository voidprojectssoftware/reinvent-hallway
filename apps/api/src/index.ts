// The Worker's composition root (ADR 0002): the one place adapters are chosen.
// Each request gets its handlers over D1 from its own bindings.
import { getEvent, identityHandlers } from "@hallway/application";
import {
  agentTokensOnD1,
  attendeesOnD1,
  calendarFeedsOnD1,
  eventsOnD1,
  linkedInOidc,
  openDatabase,
  webSessionsOnD1,
} from "@hallway/infrastructure";
import { createApp } from "./app.ts";

const app = createApp<Env>({
  handlers: (env) => {
    const db = openDatabase(env.DB);
    return {
      getEvent: getEvent(eventsOnD1(db)),
      identity: identityHandlers({
        attendees: attendeesOnD1(db),
        agentTokens: agentTokensOnD1(db),
        webSessions: webSessionsOnD1(db),
        calendarFeeds: calendarFeedsOnD1(db),
        // No connections exist until the network slice lands; it replaces this
        // with its repository's answer.
        areConnected: async () => false,
        // LinkedIn sign-in is off until the owner's LinkedIn app supplies these.
        linkedIn:
          env.LINKEDIN_CLIENT_ID && env.LINKEDIN_CLIENT_SECRET
            ? linkedInOidc({ clientId: env.LINKEDIN_CLIENT_ID, clientSecret: env.LINKEDIN_CLIENT_SECRET })
            : undefined,
      }),
    };
  },
});

export default app;
