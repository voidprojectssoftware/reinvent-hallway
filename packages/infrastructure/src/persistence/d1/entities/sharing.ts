// LinkedIn posts waiting for the member's consent (ADR 0026). A row lives ten
// minutes at most and is deleted as it is read: it is the draft (text and
// selection) of one OAuth round trip, keyed by the SHA-256 of that round
// trip's state, never the state itself. No LinkedIn token is ever stored.
import { sqliteTable, text } from "drizzle-orm/sqlite-core";
import { attendees } from "./identity.ts";

export const linkedinPostDrafts = sqliteTable("linkedin_post_drafts", {
  stateSha256: text("state_sha256").primaryKey(),
  attendeeId: text("attendee_id")
    .notNull()
    .references(() => attendees.id),
  text: text("text").notNull(),
  // The ShareSelection as JSON: { kind: "week" | "day" | "sessions", ... }.
  selection: text("selection").notNull(),
  createdAt: text("created_at").notNull(),
  expiresAt: text("expires_at").notNull(),
});
