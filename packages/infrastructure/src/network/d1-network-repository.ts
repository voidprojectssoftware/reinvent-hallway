// The NetworkRepository on D1.
//
// Contacts are the one write here that can be large: a LinkedIn export holds
// up to 30,000 rows. At four bound parameters a row, ADR 0009's multi-row
// inserts would need 1,200 statements, past D1's per-invocation query limit.
// So each statement binds one JSON array of up to `contactBytesPerStatement`
// and expands it with `json_each` (ADR 0011): 30,000 contacts are four or
// five such statements, and the whole replacement is one `batch()`, all or nothing.
//
// Lists of ids go the same way (`in (select value from json_each(?))`), so
// "who is going" over any number of sessions is one statement with a fixed
// number of parameters.
import {
  claimedProfileUrlPrefix,
  type AttendeeRecord,
  type ConnectionRequestRecord,
  type ContactImportRecord,
  type NetworkRepository,
} from "@hallway/application";
import type { Connection, ImportedContact } from "@hallway/domain";
import { and, desc, eq, gte, lt, or, sql, type SQL } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { compact } from "../identity/d1-identity-repositories.ts";
import type { Database } from "../persistence/d1/database.ts";
import { attendees, identities } from "../persistence/d1/entities/identity.ts";
import {
  connectionRequests,
  connections,
  contactImports,
  importedContacts,
  inviteTokens,
} from "../persistence/d1/entities/network.ts";
import { hiddenSessions, planEntries, sessions } from "../persistence/d1/entities/schedule.ts";
import { catalogColumns, fromEntryRow, fromSessionRow, hiddenJoin, isHidden } from "../schedule/d1-schedule-repository.ts";

/**
 * How much contact JSON one statement binds. D1 allows 2 MB in one string;
 * a quarter of that leaves room, and still puts 30,000 contacts (about 2 MB
 * of JSON, 4 MB if every row had an email) in four to eight statements.
 */
export const contactBytesPerStatement = 500_000;

/** Contacts as compact JSON arrays, cut so no chunk's JSON passes `maxBytes`. */
export function contactChunks(contacts: readonly ImportedContact[], maxBytes: number): string[] {
  const encoder = new TextEncoder();
  const chunks: string[] = [];
  let rows: string[] = [];
  let bytes = 2;
  for (const contact of contacts) {
    const row = JSON.stringify([contact.profileUrl ?? null, contact.name, contact.emailSha256 ?? null]);
    const size = encoder.encode(row).length + 1;
    if (rows.length > 0 && bytes + size > maxBytes) {
      chunks.push(`[${rows.join(",")}]`);
      rows = [];
      bytes = 2;
    }
    rows.push(row);
    bytes += size;
  }
  if (rows.length > 0) chunks.push(`[${rows.join(",")}]`);
  return chunks;
}

const ordered = (one: string, other: string) => (one < other ? [one, other] : [other, one]) as [string, string];
const jsonList = (ids: readonly string[]) => sql`(select value from json_each(${JSON.stringify([...new Set(ids)])}))`;

type ConnectionRow = typeof connections.$inferSelect;
type RequestRow = typeof connectionRequests.$inferSelect;

/**
 * Pending, written as a literal rather than a bound value: it matches the
 * partial index's own WHERE, so SQLite can use the index, and a bound
 * 'pending' beside an OR of pairs trips SQLite's planner (SQLITE_INTERNAL).
 */
const isPending = sql`${connectionRequests.status} = 'pending'`;

const fromConnectionRow = ({ a, b, since, via }: ConnectionRow): Connection => ({ a, b, since, via });
const fromRequestRow = (row: RequestRow): ConnectionRequestRecord => ({
  id: row.id,
  from: row.fromId,
  to: row.toId,
  status: row.status,
  createdAt: row.createdAt,
});
const toAttendee = (row: typeof attendees.$inferSelect): AttendeeRecord => compact(row);

export function networkOnD1(db: Database): NetworkRepository {
  const pairIs = (one: string, other: string) => {
    const [a, b] = ordered(one, other);
    return and(eq(connections.a, a), eq(connections.b, b));
  };
  const involves = (attendeeId: string) => or(eq(connections.a, attendeeId), eq(connections.b, attendeeId));
  const otherEnd = (attendeeId: string) =>
    sql`case when ${connections.a} = ${attendeeId} then ${connections.b} else ${connections.a} end`;
  const importOf = (attendeeId: string) =>
    sql`(select ${contactImports.id} from ${contactImports} where ${contactImports.attendeeId} = ${attendeeId})`;

  return {
    async areConnected(one, other) {
      const [row] = await db.select({ a: connections.a }).from(connections).where(pairIs(one, other)).limit(1);
      return row !== undefined;
    },

    async connection(one, other) {
      const [row] = await db.select().from(connections).where(pairIs(one, other)).limit(1);
      return row && fromConnectionRow(row);
    },

    async connectionsOf(attendeeId) {
      const rows = await db
        .select()
        .from(connections)
        .innerJoin(attendees, eq(attendees.id, otherEnd(attendeeId)))
        .where(involves(attendeeId));
      return rows.map((row) => ({ connection: fromConnectionRow(row.connections), other: toAttendee(row.attendees) }));
    },

    async connect(connection, at) {
      const { a, b } = connection;
      await db.batch([
        db.insert(connections).values(connection).onConflictDoNothing(),
        db
          .update(connectionRequests)
          .set({ status: "accepted", decidedAt: at })
          .where(
            and(
              isPending,
              or(
                and(eq(connectionRequests.fromId, a), eq(connectionRequests.toId, b)),
                and(eq(connectionRequests.fromId, b), eq(connectionRequests.toId, a)),
              ),
            ),
          ),
      ]);
    },

    async removeConnection(one, other) {
      await db.delete(connections).where(pairIs(one, other));
    },

    async invite(attendeeId) {
      const [row] = await db
        .select({ token: inviteTokens.token, rotatedAt: inviteTokens.rotatedAt })
        .from(inviteTokens)
        .where(eq(inviteTokens.attendeeId, attendeeId))
        .limit(1);
      return row;
    },

    async ensureInvite(attendeeId, token, at) {
      // Insert-if-absent, then read: two first asks at once agree on one token.
      await db.insert(inviteTokens).values({ attendeeId, token, rotatedAt: at }).onConflictDoNothing({
        target: inviteTokens.attendeeId,
      });
      const [row] = await db
        .select({ token: inviteTokens.token, rotatedAt: inviteTokens.rotatedAt })
        .from(inviteTokens)
        .where(eq(inviteTokens.attendeeId, attendeeId))
        .limit(1);
      return row!;
    },

    async replaceInvite(attendeeId, token, at) {
      await db
        .insert(inviteTokens)
        .values({ attendeeId, token, rotatedAt: at })
        .onConflictDoUpdate({ target: inviteTokens.attendeeId, set: { token, rotatedAt: at } });
    },

    async request(id) {
      const [row] = await db.select().from(connectionRequests).where(eq(connectionRequests.id, id)).limit(1);
      return row && fromRequestRow(row);
    },

    async pendingRequest(from, to) {
      const [row] = await db
        .select()
        .from(connectionRequests)
        .where(
          and(
            eq(connectionRequests.fromId, from),
            eq(connectionRequests.toId, to),
            isPending,
          ),
        )
        .limit(1);
      return row && fromRequestRow(row);
    },

    async pendingRequestsOf(attendeeId) {
      const rows = await db
        .select()
        .from(connectionRequests)
        .innerJoin(
          attendees,
          eq(
            attendees.id,
            sql`case when ${connectionRequests.fromId} = ${attendeeId} then ${connectionRequests.toId} else ${connectionRequests.fromId} end`,
          ),
        )
        .where(
          and(
            isPending,
            or(eq(connectionRequests.fromId, attendeeId), eq(connectionRequests.toId, attendeeId)),
          ),
        )
        .orderBy(desc(connectionRequests.createdAt), desc(connectionRequests.id));
      return rows.map((row) => ({ request: fromRequestRow(row.connection_requests), other: toAttendee(row.attendees) }));
    },

    async createRequest(request) {
      await db.insert(connectionRequests).values({
        id: request.id,
        fromId: request.from,
        toId: request.to,
        status: request.status,
        createdAt: request.createdAt,
      });
    },

    async closeRequest(id, status, at) {
      await db
        .update(connectionRequests)
        .set({ status, decidedAt: at })
        .where(and(eq(connectionRequests.id, id), isPending));
    },

    async replaceContacts(contactImport, contacts) {
      const statements: BatchItem<"sqlite">[] = [
        db.delete(importedContacts).where(sql`${importedContacts.importId} in ${importOf(contactImport.attendeeId)}`),
        db.delete(contactImports).where(eq(contactImports.attendeeId, contactImport.attendeeId)),
        db.insert(contactImports).values(contactImport),
        ...contactChunks(contacts, contactBytesPerStatement).map((json) =>
          db
            .insert(importedContacts)
            .select(
              sql`select ${contactImport.id}, json_extract(value, '$[0]'), json_extract(value, '$[1]'), json_extract(value, '$[2]') from json_each(${json})`,
            ),
        ),
      ];
      const [first, ...rest] = statements;
      await db.batch([first!, ...rest]);
    },

    async contactImport(attendeeId) {
      const [row] = await db.select().from(contactImports).where(eq(contactImports.attendeeId, attendeeId)).limit(1);
      return row;
    },

    async contactMatches(attendeeId) {
      const mine = importOf(attendeeId);
      const claimed = sql`${claimedProfileUrlPrefix} || ${importedContacts.profileUrl}`;
      const myEmails = sql`select ${importedContacts.emailSha256} from ${importedContacts} where ${importedContacts.importId} = ${mine}`;
      // Any of an attendee's verified identity emails matches (ADR 0018).
      const [candidates, hashes, contacts] = await Promise.all([
        db
          .select()
          .from(attendees)
          .where(
            or(
              sql`${attendees.id} in (select ${identities.attendeeId} from ${identities} where ${identities.verifiedEmailSha256} in (${myEmails}))`,
              sql`${attendees.linkedinProfileUrl} in (select ${claimed} from ${importedContacts} where ${importedContacts.importId} = ${mine})`,
            ),
          ),
        db
          .select({ attendeeId: identities.attendeeId, hash: identities.verifiedEmailSha256 })
          .from(identities)
          .where(sql`${identities.verifiedEmailSha256} in (${myEmails})`),
        db
          .select()
          .from(importedContacts)
          .where(
            and(
              sql`${importedContacts.importId} = ${mine}`,
              or(
                sql`${importedContacts.emailSha256} in (select ${identities.verifiedEmailSha256} from ${identities})`,
                sql`${claimed} in (select ${attendees.linkedinProfileUrl} from ${attendees})`,
              ),
            ),
          ),
      ]);
      const hashesOf = (id: string) => hashes.flatMap((row) => (row.attendeeId === id && row.hash !== null ? [row.hash] : []));
      return {
        candidates: candidates.map((row) => ({ attendee: toAttendee(row), verifiedEmailSha256s: hashesOf(row.id) })),
        contacts: contacts.map((row) => {
          const contact: ImportedContact = { name: row.name };
          if (row.profileUrl !== null) contact.profileUrl = row.profileUrl;
          if (row.emailSha256 !== null) contact.emailSha256 = row.emailSha256;
          return contact;
        }),
      };
    },

    async linkedTo(attendeeId) {
      const [connected, requested] = await Promise.all([
        db.select({ id: otherEnd(attendeeId) }).from(connections).where(involves(attendeeId)),
        db
          .select({
            id: sql<string>`case when ${connectionRequests.fromId} = ${attendeeId} then ${connectionRequests.toId} else ${connectionRequests.fromId} end`,
          })
          .from(connectionRequests)
          .where(
            and(
              isPending,
              or(eq(connectionRequests.fromId, attendeeId), eq(connectionRequests.toId, attendeeId)),
            ),
          ),
      ]);
      return new Set([...connected, ...requested].map((row) => row.id as string));
    },

    async connectionPlans(viewerId, eventId, scope) {
      const inScope: SQL | undefined =
        "sessionIds" in scope
          ? sql`${planEntries.sessionId} in ${jsonList(scope.sessionIds)}`
          : "startsFrom" in scope
            ? and(gte(sessions.startsAt, scope.startsFrom), lt(sessions.startsAt, scope.startsBefore))
            : undefined;
      const rows = await db
        .select({ attendee: attendees, entry: planEntries, session: catalogColumns, hidden: isHidden })
        .from(connections)
        .innerJoin(attendees, eq(attendees.id, otherEnd(viewerId)))
        .innerJoin(planEntries, and(eq(planEntries.attendeeId, attendees.id), eq(planEntries.eventId, eventId)))
        .innerJoin(
          sessions,
          and(eq(sessions.eventId, planEntries.eventId), eq(sessions.sessionId, planEntries.sessionId)),
        )
        .leftJoin(hiddenSessions, hiddenJoin)
        .where(and(involves(viewerId), inScope));
      return rows.map((row) => ({
        owner: toAttendee(row.attendee),
        entry: fromEntryRow(row.entry, row.hidden),
        session: fromSessionRow(row.session),
      }));
    },
  };
}
