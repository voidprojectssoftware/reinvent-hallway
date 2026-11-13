// GetMe, UpdateProfile, SetVisibility and GetAttendee (domain.md).
import type {
  AttendeeCard,
  GetAttendeeInput,
  Me,
  SetVisibilityInput,
  UpdateProfileInput,
} from "@hallway/contracts";
import {
  canViewSchedule,
  isReservedHandle,
  isValidHandle,
  normalizeHandle,
  normalizeProfileUrl,
} from "@hallway/domain";
import type { Actor } from "../actor.ts";
import { fail, ok, type Outcome } from "../outcome.ts";
import type { AreConnected, AttendeeRecord, AttendeeRepository } from "./ports.ts";
import { toCard, toMe } from "./views.ts";

export type GetMe = (actor: Actor) => Promise<Outcome<Me>>;
export type UpdateProfile = (actor: Actor, input: UpdateProfileInput) => Promise<Outcome<Me>>;
export type SetVisibility = (actor: Actor, input: SetVisibilityInput) => Promise<Outcome<Me>>;
export type GetAttendee = (actor: Actor, input: GetAttendeeInput) => Promise<Outcome<AttendeeCard>>;

/** The signed-in attendee's record, or the refusal every "me" handler gives. */
export async function signedInAttendee(
  attendees: AttendeeRepository,
  actor: Actor,
): Promise<Outcome<AttendeeRecord>> {
  if (actor.kind !== "attendee") return fail("unauthenticated", "Sign in first.");
  const attendee = await attendees.byId(actor.attendeeId);
  return attendee ? ok(attendee) : fail("not-found", `No attendee ${actor.attendeeId}.`);
}

export function getMe(attendees: AttendeeRepository): GetMe {
  return async (actor) => {
    const me = await signedInAttendee(attendees, actor);
    return me.ok ? ok(toMe(me.value)) : me;
  };
}

export function updateProfile(attendees: AttendeeRepository): UpdateProfile {
  return async (actor, input) => {
    const me = await signedInAttendee(attendees, actor);
    if (!me.ok) return me;
    let next: AttendeeRecord = { ...me.value };

    if (input.handle !== undefined) {
      const handle = normalizeHandle(input.handle);
      if (!isValidHandle(handle)) {
        return fail("invalid", "A handle is 3 to 30 of a-z, 0-9 and single hyphens, starting and ending with a letter or digit.");
      }
      if (isReservedHandle(handle)) return fail("conflict", `@${handle} is reserved.`);
      const holder = await attendees.byHandle(handle);
      if (holder && holder.id !== next.id) return fail("conflict", `@${handle} is taken.`);
      next.handle = handle;
    }
    if (input.displayName !== undefined) next.displayName = input.displayName;
    if (input.headline !== undefined) next = withOptional(next, "headline", input.headline || null);
    if (input.linkedinProfileUrl !== undefined) {
      const url = input.linkedinProfileUrl === null ? null : normalizeProfileUrl(input.linkedinProfileUrl);
      if (url === undefined) {
        return fail("invalid", "That is not a LinkedIn profile URL (linkedin.com/in/...).");
      }
      next = withOptional(next, "linkedinProfileUrl", url && `https://www.${url}`);
    }

    await attendees.save(next);
    return ok(toMe(next));
  };
}

export function setVisibility(attendees: AttendeeRepository): SetVisibility {
  return async (actor, { visibility }) => {
    const me = await signedInAttendee(attendees, actor);
    if (!me.ok) return me;
    const next = { ...me.value, visibility };
    await attendees.save(next);
    return ok(toMe(next));
  };
}

/**
 * Anyone may see an attendee's card, even a private one's; whether they may
 * see the schedule is the domain's one visibility rule.
 */
export function getAttendee(attendees: AttendeeRepository, areConnected: AreConnected): GetAttendee {
  return async (actor, input) => {
    const handle = normalizeHandle(input.handle);
    const attendee = await attendees.byHandle(handle);
    if (!attendee) return fail("not-found", `No attendee @${handle}.`);
    const viewer = actor.kind === "attendee" ? actor.attendeeId : null;
    const connected = viewer !== null && viewer !== attendee.id && (await areConnected(viewer, attendee.id));
    return ok(toCard(attendee, canViewSchedule(viewer, attendee, connected)));
  };
}

/** Sets an optional field, or removes it for null: the record never holds an explicit undefined. */
function withOptional(
  attendee: AttendeeRecord,
  key: "headline" | "linkedinProfileUrl",
  value: string | null,
): AttendeeRecord {
  const next = { ...attendee };
  if (value === null) delete next[key];
  else next[key] = value;
  return next;
}
