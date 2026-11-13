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
  IdentityRecord,
  WebSessionRecord,
  WebSessionRepository,
} from "@hallway/application";
import { noTie } from "@hallway/domain";

const copy = <T>(value: T | undefined): T | undefined => value && structuredClone(value);

/**
 * Beside the port, `all()` and `allIdentities()`: the network fake reads
 * every attendee and identity, as D1 joins the tables.
 */
export function attendeesInMemory(
  seed: readonly AttendeeRecord[] = [],
): AttendeeRepository & { all(): Promise<AttendeeRecord[]>; allIdentities(): Promise<IdentityRecord[]> } {
  const byId = new Map(seed.map((attendee) => [attendee.id, structuredClone(attendee)]));
  const identities: IdentityRecord[] = [];
  const find = (match: (attendee: AttendeeRecord) => boolean) => copy([...byId.values()].find(match));
  const assertUnique = (attendee: AttendeeRecord) => {
    for (const other of byId.values()) {
      if (other.id === attendee.id) continue;
      if (other.handle === attendee.handle) throw new Error("UNIQUE constraint failed: attendees.handle");
    }
  };
  const assertLinkable = (identity: IdentityRecord) => {
    if (!byId.has(identity.attendeeId)) throw new Error("FOREIGN KEY constraint failed");
    for (const other of identities) {
      if (other.provider === identity.provider && other.subject === identity.subject) {
        throw new Error("UNIQUE constraint failed: identities.provider, identities.subject");
      }
      if (other.attendeeId === identity.attendeeId && other.provider === identity.provider) {
        throw new Error("UNIQUE constraint failed: identities.attendee_id, identities.provider");
      }
    }
  };
  const findIdentity = (match: (identity: IdentityRecord) => boolean) => copy(identities.find(match));
  return {
    byId: async (id) => copy(byId.get(id)),
    all: async () => [...byId.values()].map((attendee) => structuredClone(attendee)),
    allIdentities: async () => structuredClone(identities),
    byHandle: async (handle) => find((attendee) => attendee.handle === handle),
    identity: async (provider, subject) =>
      findIdentity((identity) => identity.provider === provider && identity.subject === subject),
    identitiesOf: async (attendeeId) =>
      structuredClone(
        identities
          .filter((identity) => identity.attendeeId === attendeeId)
          .sort((a, b) => a.linkedAt.localeCompare(b.linkedAt) || a.provider.localeCompare(b.provider)),
      ),
    identityWithVerifiedEmail: async (hash) => findIdentity((identity) => identity.verifiedEmailSha256 === hash),
    async create(attendee, firstIdentity) {
      if (byId.has(attendee.id)) throw new Error("UNIQUE constraint failed: attendees.id");
      assertUnique(attendee);
      byId.set(attendee.id, structuredClone(attendee));
      try {
        assertLinkable(firstIdentity);
      } catch (error) {
        byId.delete(attendee.id);
        throw error;
      }
      identities.push(structuredClone(firstIdentity));
    },
    async save(attendee) {
      if (!byId.has(attendee.id)) return;
      assertUnique(attendee);
      byId.set(attendee.id, structuredClone(attendee));
    },
    async link(identity) {
      assertLinkable(identity);
      identities.push(structuredClone(identity));
    },
    async saveIdentity(identity) {
      const at = identities.findIndex((other) => other.provider === identity.provider && other.subject === identity.subject);
      if (at !== -1) identities[at] = structuredClone(identity);
    },
    async unlink(attendeeId, provider) {
      const at = identities.findIndex((identity) => identity.attendeeId === attendeeId && identity.provider === provider);
      if (at !== -1) identities.splice(at, 1);
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
 * tests: no connections and no sign-in providers unless the test brings them.
 */
export function identityInMemory(extra: Partial<IdentityPorts> = {}): IdentityPorts {
  return {
    attendees: attendeesInMemory(),
    agentTokens: agentTokensInMemory(),
    webSessions: webSessionsInMemory(),
    calendarFeeds: calendarFeedsInMemory(),
    tieBetween: async () => noTie,
    ...extra,
  };
}

export function calendarFeedsInMemory(): CalendarFeedRepository {
  const feeds = new Map<string, { token: string; rotatedAt: string }>();
  return {
    async replace(attendeeId, token, rotatedAt) {
      for (const [other, feed] of feeds) {
        if (other !== attendeeId && feed.token === token) throw new Error("UNIQUE constraint failed: calendar_feeds.token");
      }
      feeds.set(attendeeId, { token, rotatedAt });
    },
    get: async (attendeeId) => copy(feeds.get(attendeeId)),
    ownerOf: async (token) => [...feeds].find(([, feed]) => feed.token === token)?.[0],
  };
}
