// The identity repositories on D1. A nullable column comes back as null and
// the records hold no explicit undefined, so `compact` drops the nulls: the
// D1 repository then answers exactly as the in-memory one does.
import type {
  AgentTokenRecord,
  AgentTokenRepository,
  AttendeeRecord,
  AttendeeRepository,
  CalendarFeedRepository,
  WebSessionRepository,
} from "@hallway/application";
import { asc, eq } from "drizzle-orm";
import type { Database } from "../persistence/d1/database.ts";
import { agentTokens, attendees, calendarFeeds, webSessions } from "../persistence/d1/entities/identity.ts";

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
    linkedinSub: attendee.linkedinSub,
    verifiedName: attendee.verifiedName ?? null,
    email: attendee.email ?? null,
    verifiedEmailSha256: attendee.verifiedEmailSha256 ?? null,
    createdAt: attendee.createdAt,
  };
}

export function attendeesOnD1(db: Database): AttendeeRepository {
  const one = async (where: ReturnType<typeof eq>) => {
    const [row] = await db.select().from(attendees).where(where).limit(1);
    return row && compact(row);
  };
  return {
    byId: (id) => one(eq(attendees.id, id)),
    byHandle: (handle) => one(eq(attendees.handle, handle)),
    byLinkedinSub: (sub) => one(eq(attendees.linkedinSub, sub)),
    async create(attendee) {
      await db.insert(attendees).values(attendeeRow(attendee));
    },
    async save(attendee) {
      const { id, ...columns } = attendeeRow(attendee);
      await db.update(attendees).set(columns).where(eq(attendees.id, id));
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
