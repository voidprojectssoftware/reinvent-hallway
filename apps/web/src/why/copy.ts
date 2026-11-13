// The words of the "Why?" sheet (issue #87), in one place so every screen
// that opens it says the same thing. Each sentence states one of the facts
// listed on the issues (#87, #103), which come from
// docs/discovery/aws-events-api.md and ADRs 0003 and 0025; a new sentence
// needs a fact there first. Plain terms
// ("your AWS sign-in"), and no blame on AWS.

/** The part of the sheet a "Why?" link opens on. */
export type WhySection = "description" | "schedule";

export const whyTitle = "Why some things only work on re:Invent";

export const whySections: Record<WhySection, { heading: string; paragraphs: string[] }> = {
  description: {
    heading: "The full description",
    paragraphs: [
      "Hallway shows the descriptions attendees' own agents send when they sync their schedules. Hallway never copies them from the re:Invent site itself.",
      "For a session nobody has synced yet, open it on re:Invent. Everyone can open the session there.",
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

/** The Session screen's line under "Open on re:Invent" when it shows no description (issue #103). */
export const noDescription = "Hallway has no description of this session yet. Open it on re:Invent.";

/** The credit under a description, linking to the session's page on re:Invent (issue #103). */
export const descriptionCredit = "Session details from the AWS re:Invent catalog";

/** Connect your agent's one line on why an agent is the way in. */
export const whyAgentLine = "AWS's Events API only works for a program on your own computer, such as your agent.";
