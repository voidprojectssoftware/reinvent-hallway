// ListIdentities and UnlinkIdentity (domain.md). Linking is the callback's
// work (sign-in.ts), since it needs the provider's round trip.
import type { IdentityList, UnlinkIdentityInput } from "@hallway/contracts";
import type { Actor } from "../actor.ts";
import { fail, ok, type Outcome } from "../outcome.ts";
import { personAtKeyboard } from "./person-at-keyboard.ts";
import type { AttendeeRepository, RecordGitHubFollowing } from "./ports.ts";
import { signedInAttendee } from "./profile.ts";
import { providerTitle } from "./sign-in.ts";
import { toIdentity } from "./views.ts";

export type ListIdentities = (actor: Actor) => Promise<Outcome<IdentityList>>;
export type UnlinkIdentity = (actor: Actor, input: UnlinkIdentityInput) => Promise<Outcome<IdentityList>>;

export function listIdentities(attendees: AttendeeRepository): ListIdentities {
  return async (actor) => {
    const me = await signedInAttendee(attendees, actor);
    if (!me.ok) return me;
    return ok({ identities: (await attendees.identitiesOf(me.value.id)).map(toIdentity) });
  };
}

/**
 * Removes a way in, never the last one: an attendee with none could not sign
 * in again. Unlinking GitHub also forgets who they follow there (ADR 0019):
 * those follows came from that account, and they let people see the schedule.
 */
export function unlinkIdentity(attendees: AttendeeRepository, recordGitHubFollowing: RecordGitHubFollowing): UnlinkIdentity {
  return async (actor, { provider }) => {
    const person = personAtKeyboard(actor);
    if (!person.ok) return person;
    const mine = await attendees.identitiesOf(person.value);
    if (!mine.some((identity) => identity.provider === provider)) {
      return fail("not-found", `You have no ${providerTitle[provider]} account linked.`);
    }
    if (mine.length === 1) {
      return fail("conflict", `${providerTitle[provider]} is your only way to sign in. Add another before removing it.`);
    }
    await attendees.unlink(person.value, provider);
    if (provider === "github") await recordGitHubFollowing({ attendeeId: person.value, following: [] });
    const left = mine.filter((identity) => identity.provider !== provider);
    return ok({ identities: left.map(toIdentity) });
  };
}
