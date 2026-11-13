// The network tables (Drizzle models): connections, connection requests, and
// the reduced rows of a LinkedIn Connections.csv.
//
// A connection is an unordered pair kept once, the lower id in `a` (the
// domain's `connectionBetween`), so the primary key alone stops a second row
// for the same two people, whichever of them formed it.
//
// An imported contact has exactly three facts and no others (ADR 0004): a
// normalized profile URL, a normalized name, a SHA-256 of the email. Company,
// position, the connected-on date and the raw email have no column, and must
// never get one: they describe people who never signed up.
import { sql } from "drizzle-orm";
import { check, index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { attendees } from "./identity.ts";

export const connections = sqliteTable(
  "connections",
  {
    a: text("a")
      .notNull()
      .references(() => attendees.id),
    b: text("b")
      .notNull()
      .references(() => attendees.id),
    since: text("since").notNull(),
    via: text("via", { enum: ["request", "share-link"] }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.a, table.b] }),
    // The key serves lookups by `a`; this serves the other side.
    index("connections_by_b").on(table.b),
    check("connections_ordered", sql`${table.a} < ${table.b}`),
    check("connections_via", sql`${table.via} in ('request', 'share-link')`),
  ],
);

export const connectionRequests = sqliteTable(
  "connection_requests",
  {
    id: text("id").primaryKey(),
    fromId: text("from_id")
      .notNull()
      .references(() => attendees.id),
    toId: text("to_id")
      .notNull()
      .references(() => attendees.id),
    status: text("status", { enum: ["pending", "accepted", "declined", "withdrawn"] }).notNull(),
    createdAt: text("created_at").notNull(),
    decidedAt: text("decided_at"),
  },
  (table) => [
    // One pending request per direction; decided ones are history.
    uniqueIndex("connection_requests_one_pending")
      .on(table.fromId, table.toId)
      .where(sql`${table.status} = 'pending'`),
    index("connection_requests_to").on(table.toId, table.status),
    check("connection_requests_status", sql`${table.status} in ('pending', 'accepted', 'declined', 'withdrawn')`),
  ],
);

/**
 * The secret in an attendee's share link (`/@handle?invite=<token>`): showing
 * it is their consent to connect. One per attendee, rotatable. Kept readable,
 * like the calendar feed token (ADR 0008), so its owner can copy the link
 * again; only ever returned to its owner, signed in as a person.
 */
export const inviteTokens = sqliteTable("invite_tokens", {
  attendeeId: text("attendee_id")
    .primaryKey()
    .references(() => attendees.id),
  token: text("token").notNull().unique(),
  rotatedAt: text("rotated_at").notNull(),
});

/**
 * One-way follows (ADR 0019): `follower_id` follows someone, and so lets them
 * see a `network` schedule. A GitHub follow names the GitHub account
 * (`github_id`, GitHub's numeric id), which is whoever links that account in
 * `identities`, now or later; so a follow of someone not yet on Hallway
 * starts pointing at them the moment they link GitHub, with no write. A
 * LinkedIn import follow names the attendee the contact matched
 * (`followee_id`). Exactly one of the two is set, by source.
 */
export const follows = sqliteTable(
  "follows",
  {
    followerId: text("follower_id")
      .notNull()
      .references(() => attendees.id),
    source: text("source", { enum: ["github", "linkedin-import"] }).notNull(),
    followeeId: text("followee_id").references(() => attendees.id),
    githubId: text("github_id"),
    since: text("since").notNull(),
  },
  (table) => [
    uniqueIndex("follows_github")
      .on(table.followerId, table.githubId)
      .where(sql`${table.source} = 'github'`),
    uniqueIndex("follows_linkedin_import")
      .on(table.followerId, table.followeeId)
      .where(sql`${table.source} = 'linkedin-import'`),
    // "Who follows me": a tie is read from the followee's side too.
    index("follows_by_followee").on(table.followeeId),
    index("follows_by_github_id").on(table.githubId),
    check(
      "follows_target",
      sql`(${table.source} = 'github' and ${table.githubId} is not null and ${table.followeeId} is null) or (${table.source} = 'linkedin-import' and ${table.followeeId} is not null and ${table.githubId} is null)`,
    ),
  ],
);

/** One per attendee: an upload replaces the last one. */
export const contactImports = sqliteTable("contact_imports", {
  id: text("id").primaryKey(),
  attendeeId: text("attendee_id")
    .notNull()
    .unique()
    .references(() => attendees.id),
  importedAt: text("imported_at").notNull(),
  count: integer("count").notNull(),
});

export const importedContacts = sqliteTable(
  "imported_contacts",
  {
    importId: text("import_id")
      .notNull()
      .references(() => contactImports.id),
    /** `linkedin.com/in/<slug>`, from `normalizeProfileUrl`. */
    profileUrl: text("profile_url"),
    /** From `normalizeName`. */
    name: text("name").notNull(),
    emailSha256: text("email_sha256"),
  },
  (table) => [index("imported_contacts_by_import").on(table.importId)],
);
