// RotateCalendarFeed (domain.md): one secret feed URL per attendee. Rotating
// makes a new token and the old URL stops working. Like every other secret it
// is stored hashed, so the response is the only time it is shown: the calendar
// app keeps it, and the /cal route looks the feed up by the hash of its URL.
import type { CalendarFeed } from "@hallway/contracts";
import type { Actor } from "../actor.ts";
import { fail, ok, type Outcome } from "../outcome.ts";
import type { CalendarFeedRepository } from "./ports.ts";
import { randomSecret, sha256Hex } from "./secrets.ts";

export type RotateCalendarFeed = (actor: Actor) => Promise<Outcome<CalendarFeed>>;

export function rotateCalendarFeed(feeds: CalendarFeedRepository, now: () => Date): RotateCalendarFeed {
  return async (actor) => {
    if (actor.kind !== "attendee") return fail("unauthenticated", "Sign in first.");
    const token = randomSecret();
    const rotatedAt = now().toISOString();
    await feeds.replace(actor.attendeeId, await sha256Hex(token), rotatedAt);
    return ok({ token, path: `/cal/${token}.ics`, rotatedAt });
  };
}
