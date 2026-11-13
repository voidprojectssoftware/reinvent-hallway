// The identity repositories on D1. A nullable column comes back as null and
// the records hold no explicit undefined, so `compact` drops the nulls: the
// D1 repository then answers exactly as the in-memory one does.
import type {
  AgentTokenRecord,
  AgentTokenRepository,
  AttendeeRecord,
  AttendeeRepository,
  CalendarFeedRepository,
  IdentityRecord,
  WebSessionRepository,
} from "@hallway/application";
import { and, asc, eq, type SQL } from "drizzle-orm";
import type { Database } from "../persistence/d1/database.ts";
import { agentTokens, attendees, calendarFeeds, identities, webSessions } from "../persistence/d1/entities/identity.ts";

type WithoutNulls<T> = { [K in keyof T as null extends T[K] ? never : K]: T[K] } & {
  [K in keyof T as null extends T[K] ? K : never]?: Exclude<T[K], null>;
};

export function compact<T extends object>(row: T): WithoutNulls<T> {
  return Object.fromEntries(Object.entries(row).filter(([, value]) => value !== null)) as WithoutNulls<T>;
}

/** Every column of the row, optional fields absent from the record written as null. */
function attendeeRow(attendee: AttendeeRecord): typeof attendees.$inferInsert {
  return {
    id: attendee.id,
    handle: attendee.handle,
    handlePlaceholder: attendee.handlePlaceholder,
    displayName: attendee.displayName,
    headline: attendee.headline ?? null,
    avatarUrl: attendee.avatarUrl ?? null,
    linkedinProfileUrl: attendee.linkedinProfileUrl ?? null,
    visibility: attendee.visibility,
    verifiedName: attendee.verifiedName ?? null,
    email: attendee.email ?? null,
    createdAt: attendee.createdAt,
  };
}

function identityRow(identity: IdentityRecord): typeof identities.$inferInsert {
  return {
    provider: identity.provider,
    subject: identity.subject,
    attendeeId: identity.attendeeId,
    email: identity.email ?? null,
    emailVerified: identity.emailVerified,
    verifiedEmailSha256: identity.verifiedEmailSha256 ?? null,
    username: identity.username ?? null,
    linkedAt: identity.linkedAt,
  };
}

export function attendeesOnD1(db: Database): AttendeeRepository {
  const one = async (where: ReturnType<typeof eq>) => {
    const [row] = await db.select().from(attendees).where(where).limit(1);
    return row && compact(row);
  };
  const oneIdentity = async (where: SQL): Promise<IdentityRecord | undefined> => {
    const [row] = await db.select().from(identities).where(where).limit(1);
    return row && compact(row);
  };
  // `and` is undefined only when given no conditions; these are two.
  const thisIdentity = (provider: IdentityRecord["provider"], subject: string): SQL =>
    and(eq(identities.provider, provider), eq(identities.subject, subject)) as SQL;
  return {
    byId: (id) => one(eq(attendees.id, id)),
    byHandle: (handle) => one(eq(attendees.handle, handle)),
    identity: (provider, subject) => oneIdentity(thisIdentity(provider, subject)),
    async identitiesOf(attendeeId) {
      const rows = await db
        .select()
        .from(identities)
        .where(eq(identities.attendeeId, attendeeId))
        .orderBy(asc(identities.linkedAt), asc(identities.provider));
      return rows.map((row) => compact(row));
    },
    identityWithVerifiedEmail: (hash) => oneIdentity(eq(identities.verifiedEmailSha256, hash)),
    async create(attendee, firstIdentity) {
      await db.batch([
        db.insert(attendees).values(attendeeRow(attendee)),
        db.insert(identities).values(identityRow(firstIdentity)),
      ]);
    },
    async save(attendee) {
      const { id, ...columns } = attendeeRow(attendee);
      await db.update(attendees).set(columns).where(eq(attendees.id, id));
    },
    async link(identity) {
      await db.insert(identities).values(identityRow(identity));
    },
    async saveIdentity(identity) {
      const { provider, subject, ...columns } = identityRow(identity);
      await db.update(identities).set(columns).where(thisIdentity(provider, subject));
    },
    async unlink(attendeeId, provider) {
      await db.delete(identities).where(and(eq(identities.attendeeId, attendeeId), eq(identities.provider, provider)));
    },
  };
}

export function agentTokensOnD1(db: Database): AgentTokenRepository {
  const one = async (where: ReturnType<typeof eq>): Promise<AgentTokenRecord | undefined> => {
    const [row] = await db.select().from(agentTokens).where(where).limit(1);
    return row && compact(row);
  };
  return {
    async create(token) {
      await db.insert(agentTokens).values(token);
    },
    byId: (id) => one(eq(agentTokens.id, id)),
    bySecretSha256: (hash) => one(eq(agentTokens.secretSha256, hash)),
    async listFor(attendeeId) {
      const rows = await db
        .select()
        .from(agentTokens)
        .where(eq(agentTokens.attendeeId, attendeeId))
        .orderBy(asc(agentTokens.createdAt), asc(agentTokens.id));
      return rows.map((row) => compact(row));
    },
    async touch(id, at) {
      await db.update(agentTokens).set({ lastUsedAt: at }).where(eq(agentTokens.id, id));
    },
    async revoke(id, at) {
      await db.update(agentTokens).set({ revokedAt: at }).where(eq(agentTokens.id, id));
    },
  };
}

export function webSessionsOnD1(db: Database): WebSessionRepository {
  return {
    async create(session) {
      await db.insert(webSessions).values(session);
    },
    async byIdSha256(idSha256) {
      const [row] = await db.select().from(webSessions).where(eq(webSessions.idSha256, idSha256)).limit(1);
      return row;
    },
    async delete(idSha256) {
      await db.delete(webSessions).where(eq(webSessions.idSha256, idSha256));
    },
  };
}

export function calendarFeedsOnD1(db: Database): CalendarFeedRepository {
  return {
    async replace(attendeeId, token, rotatedAt) {
      await db
        .insert(calendarFeeds)
        .values({ attendeeId, token, rotatedAt })
        .onConflictDoUpdate({ target: calendarFeeds.attendeeId, set: { token, rotatedAt } });
    },
    async get(attendeeId) {
      const [row] = await db
        .select({ token: calendarFeeds.token, rotatedAt: calendarFeeds.rotatedAt })
        .from(calendarFeeds)
        .where(eq(calendarFeeds.attendeeId, attendeeId))
        .limit(1);
      return row;
    },
    async ownerOf(token) {
      const [row] = await db
        .select({ attendeeId: calendarFeeds.attendeeId })
        .from(calendarFeeds)
        .where(eq(calendarFeeds.token, token))
        .limit(1);
      return row?.attendeeId;
    },
  };
}
