// RotateCalendarFeed and GetCalendarFeed (domain.md): one secret feed URL per
// attendee. Rotating makes a new token and the old URL stops working.
//
// Unlike every other secret, the token is stored readable (ADR 0008): the
// owner must be able to see the subscribe link again without breaking the
// calendars already subscribed, and hashing would protect nothing, since
// whoever can read the database can read the schedules the feed serves. It is
// only ever returned to its owner, through these two handlers, and only to a
// person signed in, not to an agent token.
import type { CalendarFeed } from "@hallway/contracts";
import type { Actor } from "../actor.ts";
import { fail, ok, type Outcome } from "../outcome.ts";
import { personAtKeyboard } from "./person-at-keyboard.ts";
import type { CalendarFeedRepository } from "./ports.ts";
import { randomSecret } from "./secrets.ts";

export type RotateCalendarFeed = (actor: Actor) => Promise<Outcome<CalendarFeed>>;
export type GetCalendarFeed = (actor: Actor) => Promise<Outcome<CalendarFeed>>;

const toFeed = (token: string, rotatedAt: string): CalendarFeed => ({
  token,
  path: `/cal/${token}.ics`,
  rotatedAt,
});

export function rotateCalendarFeed(feeds: CalendarFeedRepository, now: () => Date): RotateCalendarFeed {
  return async (actor) => {
    const person = personAtKeyboard(actor);
    if (!person.ok) return person;
    const token = randomSecret();
    const rotatedAt = now().toISOString();
    await feeds.replace(person.value, token, rotatedAt);
    return ok(toFeed(token, rotatedAt));
  };
}

export function getCalendarFeed(feeds: CalendarFeedRepository): GetCalendarFeed {
  return async (actor) => {
    const person = personAtKeyboard(actor);
    if (!person.ok) return person;
    const feed = await feeds.get(person.value);
    return feed
      ? ok(toFeed(feed.token, feed.rotatedAt))
      : fail("not-found", "No calendar feed yet. Rotate it to make one.");
  };
}
