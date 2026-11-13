import type { EventRepository } from "@hallway/application";
import { eq } from "drizzle-orm";
import type { Database } from "../persistence/d1/database.ts";
import { events } from "../persistence/d1/entities/events.ts";

export function eventsOnD1(db: Database): EventRepository {
  return {
    async get(eventId) {
      const [row] = await db.select().from(events).where(eq(events.eventId, eventId)).limit(1);
      return row;
    },
  };
}
