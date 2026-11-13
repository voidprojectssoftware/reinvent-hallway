// The identity fakes: what apps/api's tests run on. identity-repositories.test.ts
// holds them to the D1 repositories' answers. Uniqueness is enforced as the
// tables' unique indexes enforce it, so a test cannot pass here and fail there.
import type {
  AgentTokenRecord,
  AgentTokenRepository,
  AttendeeRecord,
  AttendeeRepository,
  CalendarFeedRepository,
  IdentityPorts,
  WebSessionRecord,
  WebSessionRepository,
} from "@hallway/application";

const copy = <T>(value: T | undefined): T | undefined => value && structuredClone(value);

export function attendeesInMemory(seed: readonly AttendeeRecord[] = []): AttendeeRepository {
  const byId = new Map(seed.map((attendee) => [attendee.id, structuredClone(attendee)]));
  const find = (match: (attendee: AttendeeRecord) => boolean) => copy([...byId.values()].find(match));
  const assertUnique = (attendee: AttendeeRecord) => {
    for (const other of byId.values()) {
      if (other.id === attendee.id) continue;
      if (other.handle === attendee.handle) throw new Error("UNIQUE constraint failed: attendees.handle");
      if (other.linkedinSub === attendee.linkedinSub) throw new Error("UNIQUE constraint failed: attendees.linkedin_sub");
    }
  };
  return {
    byId: async (id) => copy(byId.get(id)),
    byHandle: async (handle) => find((attendee) => attendee.handle === handle),
    byLinkedinSub: async (sub) => find((attendee) => attendee.linkedinSub === sub),
    async create(attendee) {
      if (byId.has(attendee.id)) throw new Error("UNIQUE constraint failed: attendees.id");
      assertUnique(attendee);
      byId.set(attendee.id, structuredClone(attendee));
    },
    async save(attendee) {
      if (!byId.has(attendee.id)) return;
      assertUnique(attendee);
      byId.set(attendee.id, structuredClone(attendee));
    },
  };
}

export function agentTokensInMemory(): AgentTokenRepository {
  const byId = new Map<string, AgentTokenRecord>();
  return {
    async create(token) {
      byId.set(token.id, structuredClone(token));
    },
    byId: async (id) => copy(byId.get(id)),
    bySecretSha256: async (hash) => copy([...byId.values()].find((token) => token.secretSha256 === hash)),
    async listFor(attendeeId) {
      return [...byId.values()]
        .filter((token) => token.attendeeId === attendeeId)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
        .map((token) => structuredClone(token));
    },
    async touch(id, at) {
      const token = byId.get(id);
      if (token) token.lastUsedAt = at;
    },
    async revoke(id, at) {
      const token = byId.get(id);
      if (token) token.revokedAt = at;
    },
  };
}

export function webSessionsInMemory(): WebSessionRepository {
  const byHash = new Map<string, WebSessionRecord>();
  return {
    async create(session) {
      byHash.set(session.idSha256, structuredClone(session));
    },
    byIdSha256: async (hash) => copy(byHash.get(hash)),
    async delete(hash) {
      byHash.delete(hash);
    },
  };
}

/**
 * Every identity port in memory, for `identityHandlers(...)` in apps/api's
 * tests: no connections and no LinkedIn unless the test brings them.
 */
export function identityInMemory(extra: Partial<IdentityPorts> = {}): IdentityPorts {
  return {
    attendees: attendeesInMemory(),
    agentTokens: agentTokensInMemory(),
    webSessions: webSessionsInMemory(),
    calendarFeeds: calendarFeedsInMemory(),
    areConnected: async () => false,
    ...extra,
  };
}

/** The fake keeps its feeds readable, so tests can see what a rotation stored. */
export function calendarFeedsInMemory(): CalendarFeedRepository & {
  feeds: Map<string, { tokenSha256: string; rotatedAt: string }>;
} {
  const feeds = new Map<string, { tokenSha256: string; rotatedAt: string }>();
  return {
    feeds,
    async replace(attendeeId, tokenSha256, rotatedAt) {
      feeds.set(attendeeId, { tokenSha256, rotatedAt });
    },
  };
}
