// What leaves Hallway when a schedule is shared (issue #16): the link preview
// of `/@handle`, the share card PNG, and the calendar feed. All three read a
// SharedSchedule, and every one of them is built here through the domain's
// one visibility rule (`shareableEntries`), so no read path decides for itself.
import type { Event, Session, ShareLinks } from "@hallway/contracts";
import { canViewSchedule, normalizeHandle, shareableEntries, type Intent, type ShareSelection } from "@hallway/domain";
import type { Actor } from "../actor.ts";
import type { EventRepository } from "../events/event-repository.ts";
import { personAtKeyboard } from "../identity/person-at-keyboard.ts";
import type { AttendeeRecord, AttendeeRepository, CalendarFeedRepository, TieBetween } from "../identity/ports.ts";
import { viewerTie } from "../identity/tie.ts";
import { sha256Hex } from "../identity/secrets.ts";
import { fail, ok, type Outcome } from "../outcome.ts";
import { sessionResource } from "../schedule/resources.ts";
import type { ScheduleRepository } from "../schedule/schedule-repository.ts";

/** The one event Hallway shares (domain.md "Out of scope": no other event). */
export const sharedEventId = "reinvent2026";

export interface SharingDependencies {
  attendees: AttendeeRepository;
  calendarFeeds: CalendarFeedRepository;
  events: EventRepository;
  schedule: ScheduleRepository;
  tieBetween: TieBetween;
  /** SESSION_URL_TEMPLATE, for each session's link out. */
  sessionUrlTemplate: string;
  /**
   * The attendee's invite link path (`/@handle?invite=<token>`), made on
   * first ask. The network slice answers it (`invitePathOf`).
   */
  invitePath: (attendee: AttendeeRecord) => Promise<string>;
}

export interface SharedEntry {
  intent: Intent;
  session: Session;
}

/** An attendee's schedule as one viewer may take it away. */
export interface SharedSchedule {
  /** Only what the public card already shows. */
  attendee: { id: string; handle: string; displayName: string; headline?: string };
  event: Event;
  /** False: the viewer may see the card and nothing about the schedule, so `entries` is empty. */
  scheduleVisible: boolean;
  /** Visible to the viewer and not hidden, in start order (unplaced last). */
  entries: SharedEntry[];
  /**
   * Changes whenever anything shown changes. It goes in the share card's URL,
   * so a changed schedule is a new URL that LinkedIn has not cached.
   */
  version: string;
}

export type GetSharedSchedule = (actor: Actor, input: { handle: string }) => Promise<Outcome<SharedSchedule>>;
/** ExportCalendar: the feed's token is the credential, so there is no actor. */
export type ExportCalendar = (input: { token: string }) => Promise<Outcome<SharedSchedule>>;
/** The share sheet's links, absolute on `origin`. */
export type GetShareLinks = (actor: Actor, input: { origin: string }) => Promise<Outcome<ShareLinks>>;

export interface SharingHandlers {
  getSharedSchedule: GetSharedSchedule;
  exportCalendar: ExportCalendar;
  getShareLinks: GetShareLinks;
}

export function sharingHandlers(dependencies: SharingDependencies): SharingHandlers {
  const shared = sharedScheduleOf(dependencies);
  return {
    getSharedSchedule: async (actor, { handle }) => {
      const owner = await dependencies.attendees.byHandle(normalizeHandle(handle));
      if (!owner) return fail("not-found", `No attendee @${normalizeHandle(handle)}.`);
      return shared(actor.kind === "attendee" ? actor.attendeeId : null, owner);
    },

    // The feed is the owner's own: whoever holds the token reads it as the
    // owner, minus hidden entries. A rotated token finds no owner.
    exportCalendar: async ({ token }) => {
      const ownerId = await dependencies.calendarFeeds.ownerOf(token);
      const owner = ownerId && (await dependencies.attendees.byId(ownerId));
      if (!owner) return fail("not-found", "No calendar feed at this address. It may have been replaced.");
      return shared(owner.id, owner);
    },

    getShareLinks: async (actor, { origin }) => {
      if (actor.kind !== "attendee") return fail("unauthenticated", "Sign in first.");
      const me = await dependencies.attendees.byId(actor.attendeeId);
      if (!me) return fail("not-found", `No attendee ${actor.attendeeId}.`);
      // The card's version is the anonymous view's, since that is all
      // /og/{handle}.png ever draws (#70): it moves only when what strangers
      // see moves, and matches, so the card may be cached as current.
      const card = await shared(null, me);
      if (!card.ok) return card;
      const links: ShareLinks = {
        pageUrl: new URL(`/@${me.handle}`, origin).href,
        imageUrl: new URL(shareImagePath(me.handle, card.value.version), origin).href,
      };
      // The feed URL and the invite link are credentials: only for a person
      // signed in (ADR 0008), never for an agent token.
      const person = personAtKeyboard(actor);
      const feed = person.ok ? await dependencies.calendarFeeds.get(person.value) : undefined;
      if (feed) links.calendarUrl = new URL(calendarFeedPath(feed.token), origin).href;
      if (person.ok) {
        links.myImageUrl = new URL(myShareImagePath({ kind: "week" }), origin).href;
        links.inviteUrl = new URL(await dependencies.invitePath(me), origin).href;
      }
      return ok(links);
    },
  };
}

/**
 * `/og/{handle}.png?v=...`, the link preview's card: always the anonymous
 * view, so it may be cached by URL (#70). The owner's own picture is
 * `myShareImagePath`, a different address.
 */
export const shareImagePath = (handle: string, version: string) =>
  `/og/${encodeURIComponent(handle)}.png?v=${version}`;

/** A selection as a query string ("" for the week, "?day=..." or "?session=...&session=..."). */
export function selectionSearch(selection: ShareSelection): string {
  const query = new URLSearchParams();
  if (selection.kind === "day") query.set("day", selection.day);
  if (selection.kind === "sessions") for (const id of selection.sessionIds) query.append("session", id);
  const search = query.toString();
  return search ? `?${search}` : "";
}

/**
 * `/api/me/share-image.png`, my own picture of a selection of my week: only
 * for me, never cached (ADR 0026). Never the same address as the anonymous card.
 */
export const myShareImagePath = (selection: ShareSelection) => `/api/me/share-image.png${selectionSearch(selection)}`;

export const calendarFeedPath = (token: string) => `/cal/${token}.ics`;

/** An owner's schedule as `viewer` may take it away (`null`: anonymous). */
export function sharedScheduleOf({ events, schedule, tieBetween, sessionUrlTemplate }: SharingDependencies) {
  return async (viewer: string | null, owner: AttendeeRecord): Promise<Outcome<SharedSchedule>> => {
    const event = await events.get(sharedEventId);
    if (!event) return fail("not-found", `No event ${sharedEventId}.`);
    const tie = await viewerTie(tieBetween, viewer, owner.id);
    const scheduled = await schedule.schedule(owner.id, event.eventId);
    const shown = new Set(
      shareableEntries(
        viewer,
        owner,
        scheduled.map(({ entry }) => entry),
        tie,
      ).map((entry) => entry.sessionId),
    );
    const entries = scheduled
      .filter(({ entry }) => shown.has(entry.sessionId))
      .map(({ entry, session }) => ({ intent: entry.intent, session: sessionResource(session, sessionUrlTemplate) }));
    const attendee: SharedSchedule["attendee"] = { id: owner.id, handle: owner.handle, displayName: owner.displayName };
    if (owner.headline !== undefined) attendee.headline = owner.headline;
    const scheduleVisible = canViewSchedule(viewer, owner, tie);
    return ok({
      attendee,
      event,
      scheduleVisible,
      entries,
      version: await versionOf(attendee, scheduleVisible, entries),
    });
  };
}

/** Sixteen hex digits of the SHA-256 of everything a card or preview shows. */
async function versionOf(
  attendee: SharedSchedule["attendee"],
  scheduleVisible: boolean,
  entries: SharedEntry[],
): Promise<string> {
  const shown = entries.map(({ intent, session: s }) => [
    s.sessionId,
    intent,
    s.code,
    s.title,
    s.startsAt,
    s.endsAt,
    s.isAllDay,
    s.venue,
    s.room,
  ]);
  const text = JSON.stringify([attendee.handle, attendee.displayName, attendee.headline, scheduleVisible, shown]);
  return (await sha256Hex(text)).slice(0, 16);
}
