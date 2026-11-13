// Telling people which sessions I am going to (issue #78, ADR 0026): the
// composer's draft, my picture of a selection, and posting it to LinkedIn.
//
// Posting is outward-facing and in my name, so every handler here needs a
// person at the keyboard; an agent token is refused, and no MCP tool calls
// them. A post goes out in one OAuth round trip asking LinkedIn for
// `w_member_social`: the draft waits here keyed by the round trip's state for
// ten minutes and is taken once, and LinkedIn's token lives only inside the
// callback (the `LinkedInMember` the poster hands back). Nothing stores it.
import type { BegunLinkedInPost, PostableSession, PostDraft } from "@hallway/contracts";
import {
  canViewSchedule,
  eventDays as eventSpan,
  isEventDay,
  postText,
  selectEntries,
  toLocal,
  type ShareSelection,
} from "@hallway/domain";
import type { Actor } from "../actor.ts";
import { personAtKeyboard } from "../identity/person-at-keyboard.ts";
import type { AttendeeRecord } from "../identity/ports.ts";
import { randomSecret, sha256Hex } from "../identity/secrets.ts";
import { fail, ok, type Outcome } from "../outcome.ts";
import {
  myShareImagePath,
  sharedScheduleOf,
  type SharedEntry,
  type SharedSchedule,
  type SharingDependencies,
} from "./shared-schedule.ts";

/** How long a draft waits for LinkedIn's callback, as the sign-in state cookie does (ADR 0008). */
export const draftLifetimeMs = 10 * 60_000;

/** A post waiting for LinkedIn's consent. Found by the SHA-256 of the round trip's state, never the state. */
export interface PostDraftRecord {
  stateSha256: string;
  attendeeId: string;
  text: string;
  selection: ShareSelection;
  createdAt: string;
  expiresAt: string;
}

export interface PostDraftRepository {
  put(draft: PostDraftRecord): Promise<void>;
  /** The draft, deleted as it is read so it is used once; undefined when there is none or it expired before `now`. */
  take(stateSha256: string, now: string): Promise<PostDraftRecord | undefined>;
}

/**
 * Someone signed in to LinkedIn who agreed to let Hallway post once. Their
 * access token is inside it and nowhere else: when the callback is done with
 * it, the token is gone (ADR 0026, as GitHub's is in ADR 0019).
 */
export interface LinkedInMember {
  /** Their LinkedIn `sub`, the same id Sign In with LinkedIn stored. */
  subject: string;
  /** Uploads the picture, then creates the post with it. Throws when LinkedIn fails. */
  publish(post: { text: string; image: Uint8Array; imageAlt: string }): Promise<{ postUrn: string }>;
}

/** LinkedIn's Share on LinkedIn product behind one port; tested against a fake LinkedIn. */
export interface LinkedInPoster {
  /** The consent page asking for `w_member_social`. */
  authorizationUrl(input: { state: string; redirectUri: string }): string;
  /** Redeems the code. Undefined when LinkedIn refuses it. */
  open(input: { code: string; redirectUri: string }): Promise<LinkedInMember | undefined>;
}

export interface PostingDependencies extends SharingDependencies {
  drafts: PostDraftRepository;
  /** Absent when this server is not set up to post (no LinkedIn app, or no Share on LinkedIn product). */
  poster?: LinkedInPoster;
  now: () => Date;
}

/** My picture of a selection: the schedule as it may leave Hallway, cut to the selection, and the layout. */
export interface SelectionPicture {
  shared: SharedSchedule;
  /** Drawn as one day when the selection is one day, or sessions on one day; otherwise the week. */
  day?: string;
}

export type ComposePost = (actor: Actor, input: { origin: string; selection: ShareSelection }) => Promise<Outcome<PostDraft>>;
export type GetMyShareImage = (actor: Actor, input: { selection: ShareSelection }) => Promise<Outcome<SelectionPicture>>;
export type BeginLinkedInPost = (
  actor: Actor,
  input: { text: string; selection: ShareSelection; redirectUri: string },
) => Promise<Outcome<BegunLinkedInPost & { state: string }>>;
export type CompleteLinkedInPost = (
  actor: Actor,
  input: {
    code?: string | undefined;
    state?: string | undefined;
    /** The state this browser's cookie holds. */
    expectedState?: string | undefined;
    error?: string | undefined;
    redirectUri: string;
    /** Draws the picture (apps/api's renderer). */
    render: (picture: SelectionPicture) => Promise<Uint8Array>;
  },
) => Promise<Outcome<{ postUrn: string; postUrl: string }>>;

export interface PostingHandlers {
  composePost: ComposePost;
  getMyShareImage: GetMyShareImage;
  beginLinkedInPost: BeginLinkedInPost;
  completeLinkedInPost: CompleteLinkedInPost;
}

const agentRefusal = "Only you, signed in on the web, can tell people where you'll be. An agent token cannot.";

/** Where LinkedIn shows a post, from the URN its Posts API returned. */
export const linkedInPostUrl = (postUrn: string) => `https://www.linkedin.com/feed/update/${encodeURIComponent(postUrn)}/`;

export function postingHandlers(dependencies: PostingDependencies): PostingHandlers {
  const { attendees, drafts, poster, now } = dependencies;
  const shared = sharedScheduleOf(dependencies);

  /** The person at the keyboard and their own shareable week, or the refusal. */
  async function mine(actor: Actor): Promise<Outcome<{ me: AttendeeRecord; week: SharedSchedule }>> {
    const person = personAtKeyboard(actor);
    if (!person.ok) return person.error.kind === "forbidden" ? fail("forbidden", agentRefusal) : person;
    const me = await attendees.byId(person.value);
    if (!me) return fail("not-found", `No attendee ${person.value}.`);
    const week = await shared(me.id, me);
    return week.ok ? ok({ me, week: week.value }) : week;
  }

  /** The selection's entries, refused when it names a day outside the event or a session I may not share. */
  function select(week: SharedSchedule, selection: ShareSelection): Outcome<SharedEntry[]> {
    const { event } = week;
    if (selection.kind === "day" && !isEventDay(selection.day, event)) {
      const { first, last } = eventSpan(event);
      return fail("invalid", `day must be one of the event's days, ${first} to ${last}.`);
    }
    const chosen = selectEntries(week.entries, selection, event.timezone);
    if (selection.kind === "sessions") {
      const found = new Set(chosen.map(({ session }) => session.sessionId));
      const missing = selection.sessionIds.filter((id) => !found.has(id));
      if (missing.length > 0) {
        return fail("invalid", `Not on your week, or hidden: ${missing.join(", ")}. Only sessions on your week that you have not hidden can be shared.`);
      }
    }
    return ok(chosen);
  }

  function pictureOf(week: SharedSchedule, selection: ShareSelection, chosen: SharedEntry[]): SelectionPicture {
    const picture: SelectionPicture = { shared: { ...week, entries: chosen } };
    if (selection.kind === "day") picture.day = selection.day;
    if (selection.kind === "sessions") {
      const days = new Set(chosen.flatMap(({ session }) => (session.startsAt ? [toLocal(session.startsAt, week.event.timezone).date] : [])));
      if (days.size === 1 && chosen.every(({ session }) => session.startsAt)) picture.day = [...days][0]!;
    }
    return picture;
  }

  async function linkedInSubject(attendeeId: string): Promise<string | undefined> {
    return (await attendees.identitiesOf(attendeeId)).find((identity) => identity.provider === "linkedin")?.subject;
  }

  return {
    async composePost(actor, { origin, selection }) {
      const got = await mine(actor);
      if (!got.ok) return got;
      const { me, week } = got.value;
      const chosen = select(week, selection);
      if (!chosen.ok) return chosen;
      const tz = week.event.timezone;
      const pageUrl = new URL(`/@${me.handle}`, origin).href;
      const offered = week.entries.map(({ session }): PostableSession => {
        const { sessionId, code, title, venue, startsAt, isAllDay } = session;
        return {
          sessionId,
          ...(code !== undefined && { code }),
          ...(title !== undefined && { title }),
          ...(venue !== undefined && { venue }),
          ...(startsAt !== undefined && { startsAt, day: toLocal(startsAt, tz).date }),
          ...(isAllDay !== undefined && { isAllDay }),
        };
      });
      const { first, last } = eventSpan(week.event);
      const days: string[] = [];
      for (let day = first; day <= last; day = nextDay(day)) days.push(day);
      const direct: PostDraft["direct"] = !poster
        ? { available: false, reason: "not-configured" }
        : (await linkedInSubject(me.id)) === undefined
          ? { available: false, reason: "no-linkedin-identity" }
          : { available: true };
      return ok({
        days,
        offered,
        selected: chosen.value.map(({ session }) => session.sessionId),
        text: postText({
          eventName: week.event.name,
          timezone: tz,
          selection,
          sessions: chosen.value.map(({ session }) => session),
          pageUrl,
        }),
        maxLength: 3000,
        imageUrl: new URL(myShareImagePath(selection), origin).href,
        pageUrl,
        // What a stranger who opens the link sees: the one visibility rule, asked as no one.
        linkPreviewShowsWeek: canViewSchedule(null, me, false) && week.entries.length > 0,
        direct,
      });
    },

    async getMyShareImage(actor, { selection }) {
      const got = await mine(actor);
      if (!got.ok) return got;
      const chosen = select(got.value.week, selection);
      return chosen.ok ? ok(pictureOf(got.value.week, selection, chosen.value)) : chosen;
    },

    async beginLinkedInPost(actor, { text, selection, redirectUri }) {
      const got = await mine(actor);
      if (!got.ok) return got;
      if (!poster) return fail("not-found", "Posting to LinkedIn is not set up on this server. Open LinkedIn and paste the text instead.");
      if ((await linkedInSubject(got.value.me.id)) === undefined) {
        return fail("conflict", "Add LinkedIn as a way to sign in (Settings) before posting to it from Hallway.");
      }
      const chosen = select(got.value.week, selection);
      if (!chosen.ok) return chosen;
      if (chosen.value.length === 0) return fail("invalid", "Choose at least one session to tell people about.");
      const state = randomSecret();
      const at = now();
      await drafts.put({
        stateSha256: await sha256Hex(state),
        attendeeId: got.value.me.id,
        text,
        selection,
        createdAt: at.toISOString(),
        expiresAt: new Date(at.getTime() + draftLifetimeMs).toISOString(),
      });
      return ok({ authorizationUrl: poster.authorizationUrl({ state, redirectUri }), state });
    },

    /**
     * LinkedIn's callback. The state must be the one this browser was given,
     * its draft must still be waiting (ten minutes, once), and the person
     * signed in must be the one who wrote it and must have agreed at LinkedIn
     * as the account they linked. Then: draw the picture from the week as it
     * is now, upload it, post, and let the token go.
     */
    async completeLinkedInPost(actor, { code, state, expectedState, error, redirectUri, render }) {
      if (!poster) return fail("not-found", "Posting to LinkedIn is not set up on this server.");
      if (!state || !expectedState || state !== expectedState) {
        return fail("forbidden", "This post was not started in this browser, or took too long. Nothing was posted. Try again.");
      }
      const draft = await drafts.take(await sha256Hex(state), now().toISOString());
      if (!draft) return fail("forbidden", "This post waited more than ten minutes, or was already sent. Nothing was posted. Try again.");
      const got = await mine(actor);
      if (!got.ok) return got;
      if (got.value.me.id !== draft.attendeeId) {
        return fail("forbidden", "You are signed in as someone else than when you started. Nothing was posted.");
      }
      if (error) return fail("unauthenticated", `LinkedIn did not let Hallway post (${error}). Nothing was posted.`);
      if (!code) return fail("invalid", "LinkedIn's callback carries no authorization code. Nothing was posted.");
      const member = await poster.open({ code, redirectUri });
      if (!member) return fail("unauthenticated", "LinkedIn did not accept the authorization code. Nothing was posted.");
      if (member.subject !== (await linkedInSubject(draft.attendeeId))) {
        return fail(
          "forbidden",
          "You agreed at LinkedIn as a different account from the one linked to Hallway. Nothing was posted.",
        );
      }
      const chosen = select(got.value.week, draft.selection);
      if (!chosen.ok) return chosen;
      if (chosen.value.length === 0) return fail("invalid", "None of those sessions are on your week now. Nothing was posted.");
      const picture = pictureOf(got.value.week, draft.selection, chosen.value);
      const { postUrn } = await member.publish({
        text: draft.text,
        image: await render(picture),
        imageAlt: `${got.value.me.displayName}'s sessions at ${got.value.week.event.name}`,
      });
      return ok({ postUrn, postUrl: linkedInPostUrl(postUrn) });
    },
  };
}

function nextDay(day: string): string {
  const next = new Date(`${day}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10);
}
