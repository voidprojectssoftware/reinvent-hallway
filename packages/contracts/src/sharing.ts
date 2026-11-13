// The share sheet's links (domain.md "Show off my week"): the page to post,
// the picture to post with it, and the calendar to subscribe to.
import { z } from "zod";

export const ShareLinks = z
  .object({
    pageUrl: z.url().meta({ description: "My `/@handle` page. Its link preview shows what an anonymous visitor may see.", example: "https://hallway.example/@jane-doe" }),
    imageUrl: z.url().meta({
      description:
        "The share card PNG, 1200 by 627. Its `v` changes whenever what it shows changes, so LinkedIn fetches it again.",
      example: "https://hallway.example/og/jane-doe.png?v=3f9a1c0e5b7d2a64",
    }),
    calendarUrl: z
      .url()
      .optional()
      .meta({
        description:
          "My secret iCalendar feed. Absent until a feed is made (`POST /api/me/calendar-feed/rotate`), and never given to an agent token.",
        example: "https://hallway.example/cal/AbC.ics",
      }),
  })
  .meta({ id: "ShareLinks", description: "What the share sheet offers: my page, its picture, my calendar feed." });
export type ShareLinks = z.infer<typeof ShareLinks>;
