// The Worker's composition root (ADR 0002): the one place adapters are chosen.
// Each request gets its handlers over D1 from its own bindings.
import { getEvent } from "@hallway/application";
import { eventsOnD1, openDatabase } from "@hallway/infrastructure";
import { createApp } from "./app.ts";

const app = createApp<Env>({
  handlers: (env) => {
    const db = openDatabase(env.DB);
    return { getEvent: getEvent(eventsOnD1(db)) };
  },
});

export default app;
