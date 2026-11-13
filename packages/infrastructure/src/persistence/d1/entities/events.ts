// The events table (Drizzle model). `npm run db:generate -- <name>` writes the
// migration from this file into migrations/. Dates are kept as AWS writes them,
// ISO-8601 with the event's own offset, because that is the Event resource.
import { sqliteTable, text } from "drizzle-orm/sqlite-core";

export const events = sqliteTable("events", {
  eventId: text("event_id").primaryKey(),
  name: text("name").notNull(),
  timezone: text("timezone").notNull(),
  startDate: text("start_date").notNull(),
  endDate: text("end_date").notNull(),
});
