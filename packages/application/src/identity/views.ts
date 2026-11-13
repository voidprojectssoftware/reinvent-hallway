// The two ways an attendee leaves the application. Each names its fields one
// by one rather than spreading the record, so a private field added to the
// record later cannot reach a resource by accident: `email`, `linkedinSub`,
// `verifiedName` and `verifiedEmailSha256` are only ever copied into `Me`.
import type { AgentToken, AttendeeCard, Me } from "@hallway/contracts";
import type { AgentTokenRecord, AttendeeRecord } from "./ports.ts";

export function toMe(attendee: AttendeeRecord): Me {
  return {
    id: attendee.id,
    handle: attendee.handle,
    displayName: attendee.displayName,
    headline: attendee.headline,
    avatarUrl: attendee.avatarUrl,
    linkedinProfileUrl: attendee.linkedinProfileUrl,
    visibility: attendee.visibility,
    verifiedName: attendee.verifiedName,
    email: attendee.email,
  };
}

export function toCard(attendee: AttendeeRecord, scheduleVisible: boolean): AttendeeCard {
  return {
    id: attendee.id,
    handle: attendee.handle,
    displayName: attendee.displayName,
    headline: attendee.headline,
    avatarUrl: attendee.avatarUrl,
    linkedinProfileUrl: attendee.linkedinProfileUrl,
    visibility: attendee.visibility,
    scheduleVisible,
  };
}

export function toAgentToken(token: AgentTokenRecord): AgentToken {
  return {
    id: token.id,
    label: token.label,
    prefix: token.prefix,
    createdAt: token.createdAt,
    lastUsedAt: token.lastUsedAt,
    revokedAt: token.revokedAt,
  };
}
