// Network values to contract resources. A person leaves as a `Person`, built
// field by field like identity's `toCard`, so no private field of the record
// (email, LinkedIn subject, verified name) can ride along.
import type {
  Connection as ConnectionResource,
  ConnectionRequest as ConnectionRequestResource,
  Person,
} from "@hallway/contracts";
import type { Connection } from "@hallway/domain";
import type { AttendeeRecord } from "../identity/ports.ts";
import type { ConnectionRequestRecord } from "./ports.ts";

export function toPerson(attendee: AttendeeRecord): Person {
  return {
    id: attendee.id,
    handle: attendee.handle,
    displayName: attendee.displayName,
    headline: attendee.headline,
    avatarUrl: attendee.avatarUrl,
  };
}

export function connectionResource(connection: Connection, other: AttendeeRecord): ConnectionResource {
  return { person: toPerson(other), since: connection.since, via: connection.via };
}

export function requestResource(
  request: ConnectionRequestRecord,
  from: AttendeeRecord,
  to: AttendeeRecord,
): ConnectionRequestResource {
  return {
    id: request.id,
    from: toPerson(from),
    to: toPerson(to),
    status: request.status,
    createdAt: request.createdAt,
  };
}

/** People in the order every list of them uses: by display name, then handle. */
export const byName = (a: Person, b: Person) =>
  a.displayName.localeCompare(b.displayName) || a.handle.localeCompare(b.handle);
