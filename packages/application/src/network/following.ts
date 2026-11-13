// ListMyNetwork, ListFollowing, and storing GitHub follows (ADR 0019). A
// follow is one-way: it says whom the follower lets see their schedule, never
// the other way round. My network is my connections and the people I follow;
// whose schedule I may see in it is still the domain's one rule, answered per
// person with the same tie the reads use.
import type {
  FollowedPerson,
  Following,
  FollowSource,
  ListConnectionsInput,
  NetworkList,
  NetworkMember,
} from "@hallway/contracts";
import { canViewSchedule } from "@hallway/domain";
import type { Actor } from "../actor.ts";
import type { EventRepository } from "../events/event-repository.ts";
import type { AttendeeRepository, RecordGitHubFollowing } from "../identity/ports.ts";
import { signedInAttendee } from "../identity/profile.ts";
import { fail, ok, type Outcome } from "../outcome.ts";
import type { ScheduleRepository } from "../schedule/schedule-repository.ts";
import type { NetworkMemberRecord, NetworkRepository } from "./ports.ts";
import { networkSessionCounts, type SessionCounts } from "./schedules.ts";
import { byName, toPerson } from "./views.ts";

export type ListMyNetwork = (actor: Actor, input?: ListConnectionsInput) => Promise<Outcome<NetworkList>>;
export type ListFollowing = (actor: Actor, input?: ListConnectionsInput) => Promise<Outcome<Following>>;

export interface FollowingPorts {
  attendees: AttendeeRepository;
  network: NetworkRepository;
  events: EventRepository;
  schedule: ScheduleRepository;
}

/** My network, and with an event the counts of what I may see of each person there. */
async function readNetwork(
  { attendees, network, events, schedule }: FollowingPorts,
  actor: Actor,
  eventId: string | undefined,
): Promise<Outcome<{ me: string; members: NetworkMemberRecord[]; counts?: Map<string, SessionCounts> }>> {
  const me = await signedInAttendee(attendees, actor);
  if (!me.ok) return me;
  if (eventId !== undefined && !(await events.get(eventId))) return fail("not-found", `No event ${eventId}.`);
  const [members, counts] = await Promise.all([
    network.networkOf(me.value.id),
    eventId === undefined ? undefined : networkSessionCounts(network, schedule, me.value.id, eventId),
  ]);
  return ok({ me: me.value.id, members, ...(counts && { counts }) });
}

const visibleTo = (viewer: string, { other, tie }: NetworkMemberRecord) => canViewSchedule(viewer, other, tie);

export function listMyNetwork(ports: FollowingPorts): ListMyNetwork {
  return async (actor, { eventId } = {}) => {
    const read = await readNetwork(ports, actor, eventId);
    if (!read.ok) return read;
    const { me, members, counts } = read.value;
    const people = members.map((member): NetworkMember => {
      const how: NetworkMember["how"] = [];
      if (member.connection) how.push("connection");
      for (const follow of member.follows) how.push(follow.source);
      return {
        person: toPerson(member.other),
        how,
        ...(member.connection && { connectedSince: member.connection.since }),
        scheduleVisible: visibleTo(me, member),
        ...(counts && (counts.get(member.other.id) ?? { sessions: 0, sharedWithMe: 0 })),
      };
    });
    return ok({ people: people.sort((a, b) => byName(a.person, b.person)) });
  };
}

export function listFollowing(ports: FollowingPorts): ListFollowing {
  return async (actor, { eventId } = {}) => {
    const read = await readNetwork(ports, actor, eventId);
    if (!read.ok) return read;
    const { me, members, counts } = read.value;
    const [identities, notOnHallway] = await Promise.all([
      ports.attendees.identitiesOf(me),
      ports.network.gitHubFollowsNotOnHallway(me),
    ]);
    const from = (source: FollowSource): FollowedPerson[] =>
      members
        .flatMap((member) => {
          const follow = member.follows.find((f) => f.source === source);
          if (!follow) return [];
          return [
            {
              person: toPerson(member.other),
              since: follow.since,
              scheduleVisible: visibleTo(me, member),
              ...(counts && { sessions: counts.get(member.other.id)?.sessions ?? 0 }),
            },
          ];
        })
        .sort((a, b) => byName(a.person, b.person));
    return ok({
      github: {
        linked: identities.some((identity) => identity.provider === "github"),
        people: from("github"),
        notOnHallway,
      },
      linkedinImport: { people: from("linkedin-import") },
    });
  };
}

/** What sign-in and linking hand GitHub's following list to: it replaces my GitHub follows. */
export function recordGitHubFollowing(network: NetworkRepository, now: () => Date): RecordGitHubFollowing {
  return async ({ attendeeId, following }) =>
    network.replaceGitHubFollows(
      attendeeId,
      following.map((user) => user.id),
      now().toISOString(),
    );
}
