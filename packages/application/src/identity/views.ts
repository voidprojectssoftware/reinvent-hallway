// The two ways an attendee leaves the application. Each names its fields one
// by one rather than spreading the record, so a private field added to the
// record later cannot reach a resource by accident: `email`, `verifiedName`
// and `handlePlaceholder` are only ever copied into `Me`, and an identity's
// subject and email hash into nothing.
import type { AgentToken, AttendeeCard, Identity, Me } from "@hallway/contracts";
import type { AgentTokenRecord, AttendeeRecord, IdentityRecord } from "./ports.ts";

export function toMe(attendee: AttendeeRecord): Me {
  return {
    id: attendee.id,
    handle: attendee.handle,
    handlePlaceholder: attendee.handlePlaceholder,
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

export function toIdentity(identity: IdentityRecord): Identity {
  return {
    provider: identity.provider,
    email: identity.email,
    emailVerified: identity.emailVerified,
    username: identity.username,
    linkedAt: identity.linkedAt,
  };
}
