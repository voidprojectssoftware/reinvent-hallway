// GetInvite and RotateInvite: the secret in my share link,
// `/@handle?invite=<token>`. Whoever opens that link may connect to me at once,
// so the token is my consent (domain.md); a bare `/@handle` connects no one.
//
// Like the calendar feed (ADR 0008), it is stored readable so I can copy the
// link again without rotating, it is returned only to me signed in as a
// person (never to an agent token, which could otherwise hand out my consent
// and outlive its own revocation), and it is in no public resource.
import type { Invite } from "@hallway/contracts";
import type { Actor } from "../actor.ts";
import type { AttendeeRepository } from "../identity/ports.ts";
import { personAtKeyboard } from "../identity/person-at-keyboard.ts";
import { randomSecret } from "../identity/secrets.ts";
import { fail, ok, type Outcome } from "../outcome.ts";
import type { NetworkRepository } from "./ports.ts";

export type GetInvite = (actor: Actor) => Promise<Outcome<Invite>>;
export type RotateInvite = (actor: Actor) => Promise<Outcome<Invite>>;

export interface InvitePorts {
  attendees: AttendeeRepository;
  network: NetworkRepository;
  now: () => Date;
}

const invitePath = (handle: string, token: string) => `/@${handle}?invite=${token}`;

const toInvite = (handle: string, token: string, rotatedAt: string): Invite => ({
  token,
  path: invitePath(handle, token),
  rotatedAt,
});

/**
 * The share sheet's invite link for an attendee, made on first ask. Sharing
 * calls it only for the owner signed in as a person.
 */
export function invitePathOf(network: NetworkRepository, now: () => Date) {
  return async (attendee: { id: string; handle: string }) => {
    const invite = await network.ensureInvite(attendee.id, randomSecret(), now().toISOString());
    return invitePath(attendee.handle, invite.token);
  };
}

/** My invite, made on first ask: there is nothing to rotate before then. */
export function getInvite({ attendees, network, now }: InvitePorts): GetInvite {
  return async (actor) => {
    const person = personAtKeyboard(actor);
    if (!person.ok) return person;
    const me = await attendees.byId(person.value);
    if (!me) return fail("not-found", `No attendee ${person.value}.`);
    const invite = await network.ensureInvite(me.id, randomSecret(), now().toISOString());
    return ok(toInvite(me.handle, invite.token, invite.rotatedAt));
  };
}

/** A new token; links with the old one stop connecting. Existing connections stay. */
export function rotateInvite({ attendees, network, now }: InvitePorts): RotateInvite {
  return async (actor) => {
    const person = personAtKeyboard(actor);
    if (!person.ok) return person;
    const me = await attendees.byId(person.value);
    if (!me) return fail("not-found", `No attendee ${person.value}.`);
    const token = randomSecret();
    const rotatedAt = now().toISOString();
    await network.replaceInvite(me.id, token, rotatedAt);
    return ok(toInvite(me.handle, token, rotatedAt));
  };
}

/**
 * Whether `offered` is the attendee's current invite. Compared in full, at a
 * cost that does not depend on where the strings first differ.
 */
export async function isCurrentInvite(
  network: NetworkRepository,
  attendeeId: string,
  offered: string | undefined,
): Promise<boolean> {
  if (!offered) return false;
  const current = await network.invite(attendeeId);
  if (!current || current.token.length !== offered.length) return false;
  let difference = 0;
  for (let i = 0; i < offered.length; i++) difference |= offered.charCodeAt(i) ^ current.token.charCodeAt(i);
  return difference === 0;
}
