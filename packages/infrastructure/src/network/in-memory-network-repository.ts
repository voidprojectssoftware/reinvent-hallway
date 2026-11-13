// The network fake: answers as the D1 repository does
// (network-repository.test.ts holds both to it). It reads attendees and plans
// through the identity and schedule fakes it is given, as the D1 one joins
// their tables.
import {
  claimedProfileUrlPrefix,
  type AttendeeRecord,
  type AttendeeRepository,
  type ConnectionPlan,
  type ConnectionRequestRecord,
  type ContactImportRecord,
  type InviteRecord,
  type NetworkRepository,
  type ScheduleRepository,
} from "@hallway/application";
import type { Connection, ImportedContact } from "@hallway/domain";

/** The attendee fake, which can also list everyone (the D1 one joins its table instead). */
export interface ListableAttendees extends AttendeeRepository {
  all(): Promise<AttendeeRecord[]>;
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
      const emails = new Set(everyone.flatMap((a) => (a.verifiedEmailSha256 ? [a.verifiedEmailSha256] : [])));
      const urls = new Set(everyone.flatMap((a) => (a.linkedinProfileUrl ? [a.linkedinProfileUrl] : [])));
      const claimed = (contact: ImportedContact) =>
        contact.profileUrl === undefined ? undefined : `${claimedProfileUrlPrefix}${contact.profileUrl}`;
      const matching = contacts.filter(
        (contact) => (contact.emailSha256 && emails.has(contact.emailSha256)) || urls.has(claimed(contact) ?? ""),
      );
      const contactEmails = new Set(matching.map((contact) => contact.emailSha256));
      const contactUrls = new Set(matching.map(claimed));
      return {
        contacts: structuredClone(matching),
        candidates: everyone.filter(
          (a) =>
            (a.verifiedEmailSha256 && contactEmails.has(a.verifiedEmailSha256)) ||
            (a.linkedinProfileUrl && contactUrls.has(a.linkedinProfileUrl)),
        ),
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

    async connectionPlans(viewerId, eventId, scope) {
      const plans: ConnectionPlan[] = [];
      const wanted = "sessionIds" in scope ? new Set(scope.sessionIds) : undefined;
      for (const connection of pairs.values()) {
        if (connection.a !== viewerId && connection.b !== viewerId) continue;
        const owner = await attendees.byId(otherEnd(connection, viewerId));
        if (!owner) continue;
        for (const { entry, session } of await schedule.schedule(owner.id, eventId)) {
          const inScope = wanted
            ? wanted.has(entry.sessionId)
            : !("startsFrom" in scope) ||
              (session.startsAt !== undefined &&
                session.startsAt >= scope.startsFrom &&
                session.startsAt < scope.startsBefore);
          if (inScope) plans.push({ owner, entry, session });
        }
      }
      return plans;
    },
  };
}
