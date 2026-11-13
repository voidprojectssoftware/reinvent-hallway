// The Worker's composition root (ADR 0002): the one place adapters are chosen.
// Each request gets its handlers over D1 from its own bindings.
import { getEvent, scheduleHandlers } from "@hallway/application";
import { eventsOnD1, openDatabase, scheduleOnD1 } from "@hallway/infrastructure";
import { createApp } from "./app.ts";

const app = createApp<Env>({
  handlers: (env) => {
    const db = openDatabase(env.DB);
    const events = eventsOnD1(db);
    return {
      getEvent: getEvent(events),
      ...scheduleHandlers({
        events,
        schedule: scheduleOnD1(db),
        sessionUrlTemplate: env.SESSION_URL_TEMPLATE,
        now: () => new Date(),
      }),
    };
  },
});

export default app;
