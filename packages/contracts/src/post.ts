// Telling people which sessions I am going to (issue #78, ADR 0026): the
// composer's draft, my picture for a selection, and starting a LinkedIn post.
import { z } from "zod";
import { SessionId } from "./schedule.ts";

/** LinkedIn caps a post's commentary at 3,000 characters (the domain's `postTextLimit`). */
const maxPostText = 3000;

const Day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .meta({ description: "One day of the event, in Las Vegas time.", example: "2026-12-01" });

/**
 * A selection in a query string: nothing for the whole week, `day`, or one
 * `session` per chosen session. A lone `session` arrives as a string, several
 * as a list.
 */
export const ShareSelectionQuery = z
  .object({
    day: Day.optional(),
    session: z
      .union([SessionId, z.array(SessionId).max(200)])
      .optional()
      .transform((value) => (value === undefined ? undefined : [value].flat()))
      .meta({ description: "A session to show; repeat it for each. Leave out `day` and `session` for the whole week." }),
  })
  .refine((query) => !(query.day && query.session), { message: "Choose a day or sessions, not both." });
export type ShareSelectionQuery = z.infer<typeof ShareSelectionQuery>;

export const PostableSession = z
  .object({
    sessionId: SessionId,
    code: z.string().optional(),
    title: z.string().optional(),
    venue: z.string().optional(),
    startsAt: z.string().optional(),
    isAllDay: z.boolean().optional(),
    day: Day.optional().meta({ description: "The Las Vegas day it starts on; absent when it has no time." }),
  })
  .meta({ id: "PostableSession", description: "A session on my week that I may tell people about. Hidden ones are never offered." });
export type PostableSession = z.infer<typeof PostableSession>;

export const PostDraft = z
  .object({
    days: z.array(Day).meta({ description: "The event's days, for choosing one." }),
    offered: z.array(PostableSession).meta({ description: "Every session I may share: my week minus hidden ones, in start order." }),
    selected: z.array(SessionId).meta({ description: "The sessions this selection takes, in start order." }),
    text: z.string().max(maxPostText).meta({
      description:
        "The post Hallway suggests: each session's title, code, day and time in Las Vegas time and venue, and my page's link. Never an abstract. Within LinkedIn's 3,000 characters.",
    }),
    maxLength: z.literal(maxPostText),
    imageUrl: z.url().meta({ description: "My picture of exactly this selection (`GET /api/me/share-image.png`). Only I can open it." }),
    pageUrl: z.url().meta({ description: "My `/@handle` page, the link in the post." }),
    linkPreviewShowsWeek: z.boolean().meta({
      description: "False when my week is not public (or empty): people who open the link see my name, not my week.",
    }),
    direct: z
      .discriminatedUnion("available", [
        z.object({ available: z.literal(true) }),
        z.object({
          available: z.literal(false),
          reason: z.enum(["not-configured", "no-linkedin-identity"]).meta({
            description:
              "`not-configured`: this server cannot post to LinkedIn. `no-linkedin-identity`: add LinkedIn as a way to sign in first.",
          }),
        }),
      ])
      .meta({ description: "Whether Post to LinkedIn can post for me. The fallback (open LinkedIn, copy, save picture) always works." }),
  })
  .meta({ id: "PostDraft", description: "The composer's starting point for one selection of my week." });
export type PostDraft = z.infer<typeof PostDraft>;

export const BeginLinkedInPostInput = z
  .object({
    text: z.string().trim().min(1).max(maxPostText).meta({ description: "The post as I edited it." }),
    day: Day.optional(),
    sessionIds: z.array(SessionId).min(1).max(200).optional(),
  })
  .refine((input) => !(input.day && input.sessionIds), { message: "Choose a day or sessions, not both." })
  .meta({ id: "BeginLinkedInPostInput", description: "What to post: the text, and the selection whose picture goes with it." });
export type BeginLinkedInPostInput = z.infer<typeof BeginLinkedInPostInput>;

export const BegunLinkedInPost = z
  .object({
    authorizationUrl: z.url().meta({ description: "LinkedIn's consent page, asking to post for me once. Send the browser there." }),
  })
  .meta({ id: "BegunLinkedInPost", description: "The draft is held for ten minutes, for one callback." });
export type BegunLinkedInPost = z.infer<typeof BegunLinkedInPost>;
