// The words of the "Why?" sheet (issue #87), in one place so every screen
// that opens it says the same thing. Each sentence states one of the facts
// listed on the issue, which come from docs/discovery/aws-events-api.md and
// ADRs 0003 and 0025; a new sentence needs a fact there first. Plain terms
// ("your AWS sign-in"), and no blame on AWS.

/** The part of the sheet a "Why?" link opens on. */
export type WhySection = "description" | "schedule";

export const whyTitle = "Why some things only work on re:Invent";

export const whySections: Record<WhySection, { heading: string; paragraphs: string[] }> = {
  description: {
    heading: "The full description",
    paragraphs: [
      "re:Invent's session catalog is not public. AWS shows it only to registered attendees who are signed in. Hallway only knows what attendees' own agents send.",
      "To respect that, Hallway shows the full description once your synced schedule confirms you can read the catalog. That happens when another attendee's agent sends the same description for one of your sessions. Hallway never shows it on public pages or link previews.",
      "Until then, open it on re:Invent. Everyone can open the session there.",
    ],
  },
  schedule: {
    heading: "Changing your schedule",
    paragraphs: [
      "AWS's Events API only works for a program running on your own computer: an AI agent, a command-line tool or a desktop app. That program signs you in and keeps your AWS sign-in on your computer.",
      "AWS does not let websites, Hallway included, sign you in or read or change your schedule. Its sign-in only returns to your own computer, and its API refuses requests from web pages. AWS designed it this way to keep your account safe.",
      "Hallway never asks for or stores your AWS sign-in, which is also why it cannot reserve, cancel or favorite for you.",
      "Here you can add sessions by hand, hide sessions, and see and share your week. To reserve, cancel or favorite, use re:Invent or your agent. Then sync again, and Hallway mirrors it.",
    ],
  },
};

/** The closing next step: the session on re:Invent when there is one, else a fresh sync. */
export const whyNext = { open: "Open on re:Invent", sync: "Sync again with your agent" } as const;

/**
 * Where the reader stands with descriptions (issue #88), for the Session
 * screen's line under "Open on re:Invent" when it shows none.
 */
export type DescriptionReader = "signed-out" | "never-synced" | "unconfirmed" | "confirmed";

/** Why this reader sees no description of this session. */
export const whyNoDescription: Record<DescriptionReader, string> = {
  "signed-out": "Hallway shows descriptions only to signed-in attendees whose synced schedule confirms they can read the catalog.",
  "never-synced": "Descriptions show here once your agent syncs your schedule and another attendee's agent sends the same description for one of your sessions.",
  unconfirmed: "Descriptions show here once another attendee's agent sends the same description for one of your sessions.",
  confirmed: "Hallway has no description of this session yet.",
};

/** Connect your agent's one line on why an agent is the way in. */
export const whyAgentLine = "AWS's Events API only works for a program on your own computer, such as your agent.";
