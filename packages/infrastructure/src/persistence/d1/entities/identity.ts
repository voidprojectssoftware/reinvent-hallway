// The identity tables (Drizzle models): attendees, and the three kinds of
// secret that act for one. Session and agent token columns hold a SHA-256
// hex, never the secret, and are looked up by that hash; the calendar feed
// token is the exception, below. Instants are ISO-8601 UTC text, which sorts
// and compares as time does.
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const attendees = sqliteTable("attendees", {
  id: text("id").primaryKey(),
  handle: text("handle").notNull().unique(),
  handlePlaceholder: integer("handle_placeholder", { mode: "boolean" }).notNull().default(false),
  displayName: text("display_name").notNull(),
  headline: text("headline"),
  avatarUrl: text("avatar_url"),
  linkedinProfileUrl: text("linkedin_profile_url"),
  visibility: text("visibility", { enum: ["public", "connections", "private"] })
    .notNull()
    .default("connections"),
  linkedinSub: text("linkedin_sub").notNull().unique(),
  verifiedName: text("verified_name"),
  email: text("email"),
  verifiedEmailSha256: text("verified_email_sha256"),
  createdAt: text("created_at").notNull(),
}, (table) => [index("attendees_verified_email_sha256").on(table.verifiedEmailSha256)]);

export const agentTokens = sqliteTable(
  "agent_tokens",
  {
    id: text("id").primaryKey(),
    attendeeId: text("attendee_id")
      .notNull()
      .references(() => attendees.id),
    label: text("label").notNull(),
    prefix: text("prefix").notNull(),
    secretSha256: text("secret_sha256").notNull().unique(),
    createdAt: text("created_at").notNull(),
    lastUsedAt: text("last_used_at"),
    revokedAt: text("revoked_at"),
  },
  (table) => [index("agent_tokens_attendee_id").on(table.attendeeId)],
);

export const webSessions = sqliteTable(
  "web_sessions",
  {
    idSha256: text("id_sha256").primaryKey(),
    attendeeId: text("attendee_id")
      .notNull()
      .references(() => attendees.id),
    createdAt: text("created_at").notNull(),
    expiresAt: text("expires_at").notNull(),
  },
  (table) => [index("web_sessions_attendee_id").on(table.attendeeId)],
);

// The one secret kept readable (ADR 0008): its owner must see the subscribe
// link again, and the /cal route finds the feed by it.
export const calendarFeeds = sqliteTable("calendar_feeds", {
  attendeeId: text("attendee_id")
    .primaryKey()
    .references(() => attendees.id),
  token: text("token").notNull().unique(),
  rotatedAt: text("rotated_at").notNull(),
});
