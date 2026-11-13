// The Event resource (docs/architecture/domain.md): re:Invent 2026 as AWS
// describes it. Seeded by a migration, never created by a user.
//
// Plain zod with `.meta()`: @hono/zod-openapi reads the `id` as the OpenAPI
// component name, and the MCP SDK reads the same schema for the tool input,
// so contracts needs neither of them and the web app can import it cheaply.
import { z } from "zod";

// AWS writes `2026-11-30T05:30-08:00`: an offset and no seconds, which
// z.iso.datetime refuses unless told the exact precision. Seconds and
// fractions are allowed too, so a later AWS format change is not a 500.
const isoWithOffset = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

export const EventId = z
  .string()
  .min(1)
  .max(128)
  .meta({ description: "AWS's event id, e.g. `reinvent2026`.", example: "reinvent2026" });

export const Event = z
  .object({
    eventId: EventId,
    name: z.string().meta({ example: "re:Invent 2026" }),
    timezone: z
      .string()
      .meta({ description: "IANA timezone the event runs in.", example: "America/Los_Angeles" }),
    startDate: z
      .string()
      .regex(isoWithOffset)
      .meta({ description: "ISO-8601 with UTC offset, as AWS gives it.", example: "2026-11-30T05:30-08:00" }),
    endDate: z
      .string()
      .regex(isoWithOffset)
      .meta({ description: "ISO-8601 with UTC offset, as AWS gives it.", example: "2026-12-04T23:59-08:00" }),
  })
  .meta({ id: "Event", description: "An AWS event Hallway knows about." });
export type Event = z.infer<typeof Event>;

/** The input of `GET /api/events/{eventId}` (its path) and of the `get_event` tool. */
export const GetEventInput = z.object({ eventId: EventId });
export type GetEventInput = z.infer<typeof GetEventInput>;
