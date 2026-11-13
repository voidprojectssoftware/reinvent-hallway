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
