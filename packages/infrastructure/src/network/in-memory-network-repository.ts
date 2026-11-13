// The network fake: answers as the D1 repository does
// (network-repository.test.ts holds both to it). It reads attendees and plans
// through the identity and schedule fakes it is given, as the D1 one joins
// their tables.
import {
  claimedProfileUrlPrefix,
  type AttendeeRecord,
  type AttendeeRepository,
  type NetworkMemberRecord,
  type NetworkPlan,
  type ConnectionRequestRecord,
  type ContactImportRecord,
  type IdentityRecord,
  type InviteRecord,
  type NetworkRepository,
  type ScheduleRepository,
} from "@hallway/application";
import type { Connection, FollowSource, ImportedContact, Tie } from "@hallway/domain";

/** The attendee fake, which can also list everyone and every identity (the D1 one joins the tables instead). */
export interface ListableAttendees extends AttendeeRepository {
  all(): Promise<AttendeeRecord[]>;
  allIdentities(): Promise<IdentityRecord[]>;
}

export function networkInMemory({
  attendees,
  schedule,
}: {
  attendees: ListableAttendees;
  schedule: ScheduleRepository;
}): NetworkRepository {
  const pairs = new Map<string, Connection>();
  const requests = new Map<string, ConnectionRequestRecord>();
  const imports = new Map<string, { record: ContactImportRecord; contacts: ImportedContact[] }>();
  const key = (one: string, other: string) => (one < other ? `${one}\n${other}` : `${other}\n${one}`);
  const otherEnd = (connection: Connection, me: string) => (connection.a === me ? connection.b : connection.a);
  const pending = () => [...requests.values()].filter((request) => request.status === "pending");
  const invites = new Map<string, InviteRecord>();
  const putInvite = (attendeeId: string, token: string, rotatedAt: string) => {
    for (const [other, invite] of invites) {
      if (other !== attendeeId && invite.token === token) throw new Error("UNIQUE constraint failed: invite_tokens.token");
    }
    invites.set(attendeeId, { token, rotatedAt });
  };

  // A follow names a GitHub account or an attendee, as the follows table does;
  // a GitHub one reaches whoever has linked that account at the time of asking.
  interface FollowRow {
    follower: string;
    source: FollowSource;
    target: string;
    since: string;
  }
  let followRows: FollowRow[] = [];
  const followee = async ({ source, target }: FollowRow) =>
    source === "linkedin-import" ? target : (await attendees.identity("github", target))?.attendeeId;
  const replaceFollows = (follower: string, source: FollowSource, targets: readonly string[], at: string) => {
    const kept = new Set(targets);
    followRows = followRows.filter((row) => row.follower !== follower || row.source !== source || kept.has(row.target));
    for (const target of kept) {
      if (!followRows.some((row) => row.follower === follower && row.source === source && row.target === target)) {
        followRows.push({ follower, source, target, since: at });
      }
    }
  };
  const tieOf = async (viewer: string, owner: string): Promise<Tie> => {
    let followedByOwner = false;
    for (const row of followRows) {
      if (row.follower === owner && (await followee(row)) === viewer) followedByOwner = true;
    }
    return { connected: pairs.has(key(viewer, owner)), followedByOwner };
  };
  /** My connections, and everyone I follow who is on Hallway, never me. */
  const networkIds = async (me: string) => {
    const ids = new Set<string>();
    for (const connection of pairs.values()) {
      if (connection.a === me || connection.b === me) ids.add(otherEnd(connection, me));
    }
    for (const row of followRows) {
      if (row.follower !== me) continue;
      const id = await followee(row);
      if (id !== undefined && id !== me) ids.add(id);
    }
    return ids;
  };

  return {
    invite: async (attendeeId) => structuredClone(invites.get(attendeeId)),
    async ensureInvite(attendeeId, token, at) {
      if (!invites.has(attendeeId)) putInvite(attendeeId, token, at);
      return structuredClone(invites.get(attendeeId)!);
    },
    async replaceInvite(attendeeId, token, at) {
      putInvite(attendeeId, token, at);
    },

    areConnected: async (one, other) => pairs.has(key(one, other)),
    connection: async (one, other) => structuredClone(pairs.get(key(one, other))),

    async connectionsOf(attendeeId) {
      const found = [];
      for (const connection of pairs.values()) {
        if (connection.a !== attendeeId && connection.b !== attendeeId) continue;
        const other = await attendees.byId(otherEnd(connection, attendeeId));
        if (other) found.push({ connection: structuredClone(connection), other });
      }
      return found;
    },

    async connect(connection) {
      if (connection.a >= connection.b) throw new Error("CHECK constraint failed: connections_ordered");
      const pair = key(connection.a, connection.b);
      if (!pairs.has(pair)) pairs.set(pair, structuredClone(connection));
      for (const request of pending()) {
        if (key(request.from, request.to) === pair) request.status = "accepted";
      }
    },

    async removeConnection(one, other) {
      pairs.delete(key(one, other));
    },

    request: async (id) => structuredClone(requests.get(id)),
    pendingRequest: async (from, to) =>
      structuredClone(pending().find((request) => request.from === from && request.to === to)),

    async pendingRequestsOf(attendeeId) {
      const found = [];
      const mine = pending()
        .filter((request) => request.from === attendeeId || request.to === attendeeId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
      for (const request of mine) {
        const other = await attendees.byId(request.from === attendeeId ? request.to : request.from);
        if (other) found.push({ request: structuredClone(request), other });
      }
      return found;
    },

    async createRequest(request) {
      if (pending().some((other) => other.from === request.from && other.to === request.to)) {
        throw new Error("UNIQUE constraint failed: connection_requests.from_id, connection_requests.to_id");
      }
      requests.set(request.id, structuredClone(request));
    },

    async closeRequest(id, status) {
      const request = requests.get(id);
      if (request?.status === "pending") request.status = status;
    },

    async replaceContacts(record, contacts) {
      imports.set(record.attendeeId, { record: structuredClone(record), contacts: structuredClone([...contacts]) });
    },

    contactImport: async (attendeeId) => structuredClone(imports.get(attendeeId)?.record),

    async contactMatches(attendeeId) {
      const contacts = imports.get(attendeeId)?.contacts ?? [];
      const everyone = await attendees.all();
      const verified = (await attendees.allIdentities()).filter((identity) => identity.verifiedEmailSha256 !== undefined);
      const emails = new Set(verified.map((identity) => identity.verifiedEmailSha256));
      const urls = new Set(everyone.flatMap((a) => (a.linkedinProfileUrl ? [a.linkedinProfileUrl] : [])));
      const claimed = (contact: ImportedContact) =>
        contact.profileUrl === undefined ? undefined : `${claimedProfileUrlPrefix}${contact.profileUrl}`;
      const matching = contacts.filter(
        (contact) => (contact.emailSha256 && emails.has(contact.emailSha256)) || urls.has(claimed(contact) ?? ""),
      );
      const contactEmails = new Set(matching.map((contact) => contact.emailSha256));
      const contactUrls = new Set(matching.map(claimed));
      const matchingHashes = (attendee: AttendeeRecord) =>
        verified
          .filter((identity) => identity.attendeeId === attendee.id && contactEmails.has(identity.verifiedEmailSha256))
          .map((identity) => identity.verifiedEmailSha256!);
      return {
        contacts: structuredClone(matching),
        candidates: everyone.flatMap((attendee) => {
          const verifiedEmailSha256s = matchingHashes(attendee);
          const byUrl = attendee.linkedinProfileUrl !== undefined && contactUrls.has(attendee.linkedinProfileUrl);
          return verifiedEmailSha256s.length > 0 || byUrl ? [{ attendee, verifiedEmailSha256s }] : [];
        }),
      };
    },

    async linkedTo(attendeeId) {
      const linked = new Set<string>();
      for (const connection of pairs.values()) {
        if (connection.a === attendeeId || connection.b === attendeeId) linked.add(otherEnd(connection, attendeeId));
      }
      for (const request of pending()) {
        if (request.from === attendeeId) linked.add(request.to);
        if (request.to === attendeeId) linked.add(request.from);
      }
      return linked;
    },

    async tie(viewer, owner) {
      return tieOf(viewer, owner);
    },

    async replaceGitHubFollows(attendeeId, gitHubIds, at) {
      replaceFollows(attendeeId, "github", gitHubIds, at);
    },

    async replaceImportFollows(attendeeId, followeeIds, at) {
      replaceFollows(attendeeId, "linkedin-import", followeeIds, at);
    },

    async networkOf(attendeeId) {
      const members: NetworkMemberRecord[] = [];
      for (const id of await networkIds(attendeeId)) {
        const other = await attendees.byId(id);
        if (!other) continue;
        const connection = pairs.get(key(attendeeId, id));
        const mine = [];
        for (const follow of followRows.filter((row) => row.follower === attendeeId)) {
          if ((await followee(follow)) === id) mine.push({ source: follow.source, since: follow.since });
        }
        members.push({
          other,
          ...(connection && { connection: structuredClone(connection) }),
          follows: mine.sort((a, b) => a.source.localeCompare(b.source)),
          tie: await tieOf(attendeeId, id),
        });
      }
      return members;
    },

    async gitHubFollowsNotOnHallway(attendeeId) {
      let count = 0;
      for (const follow of followRows) {
        if (follow.follower === attendeeId && follow.source === "github" && (await followee(follow)) === undefined) count += 1;
      }
      return count;
    },

    async networkPlans(viewerId, eventId, scope) {
      const plans: NetworkPlan[] = [];
      const wanted = "sessionIds" in scope ? new Set(scope.sessionIds) : undefined;
      for (const id of await networkIds(viewerId)) {
        const owner = await attendees.byId(id);
        if (!owner) continue;
        const tie = await tieOf(viewerId, owner.id);
        for (const { entry, session } of await schedule.schedule(owner.id, eventId)) {
          const inScope = wanted
            ? wanted.has(entry.sessionId)
            : !("startsFrom" in scope) ||
              (session.startsAt !== undefined &&
                session.startsAt >= scope.startsFrom &&
                session.startsAt < scope.startsBefore);
          if (inScope) plans.push({ owner, tie, entry, session });
        }
      }
      return plans;
    },
  };
}
