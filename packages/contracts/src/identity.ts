// The identity resources (docs/architecture/domain.md: Attendee, Agent token,
// Calendar feed) and the inputs of the commands that change them.
//
// Two shapes of an attendee, on purpose: `Me` carries my private fields and is
// only ever returned to me; `AttendeeCard` is what anyone else may see and has
// no field that could carry `email`, `linkedinSub` or `verifiedName`.
import { z } from "zod";

export const Visibility = z
  .enum(["public", "connections", "private"])
  .meta({ id: "Visibility", description: "Who may see the attendee's schedule." });
export type Visibility = z.infer<typeof Visibility>;

export const Handle = z
  .string()
  .min(1)
  .max(31)
  .meta({ description: "The share URL's `@handle`, 3 to 30 of a-z, 0-9 and single hyphens.", example: "jane-doe" });

const publicFields = {
  id: z.string(),
  handle: Handle,
  displayName: z.string().meta({ example: "Jane Doe" }),
  headline: z.string().optional().meta({ example: "Principal engineer, Example Corp" }),
  avatarUrl: z.string().optional(),
  linkedinProfileUrl: z
    .string()
    .optional()
    .meta({ description: "Claimed by the attendee, not verified.", example: "https://www.linkedin.com/in/jane-doe" }),
  visibility: Visibility,
};

export const Me = z
  .object({
    ...publicFields,
    verifiedName: z
      .string()
      .optional()
      .meta({ description: "The name LinkedIn verified at sign-in. Not editable." }),
    email: z.string().optional().meta({ description: "Present only when LinkedIn said it is verified." }),
  })
  .meta({ id: "Me", description: "The signed-in attendee, with private fields." });
export type Me = z.infer<typeof Me>;

export const AttendeeCard = z
  .object({
    ...publicFields,
    scheduleVisible: z.boolean().meta({ description: "Whether the asker may see this attendee's schedule." }),
  })
  .meta({ id: "AttendeeCard", description: "What anyone may see of an attendee." });
export type AttendeeCard = z.infer<typeof AttendeeCard>;

export const GetAttendeeInput = z.object({ handle: Handle });
export type GetAttendeeInput = z.infer<typeof GetAttendeeInput>;

/** Absent leaves a field as it is; `null` clears an optional one. */
export const UpdateProfileInput = z
  .object({
    handle: Handle.optional(),
    displayName: z.string().trim().min(1).max(100).optional(),
    headline: z.string().trim().max(200).nullable().optional(),
    linkedinProfileUrl: z.string().max(300).nullable().optional(),
  })
  .meta({ id: "UpdateProfile" });
export type UpdateProfileInput = z.infer<typeof UpdateProfileInput>;

export const SetVisibilityInput = z.object({ visibility: Visibility }).meta({ id: "SetVisibility" });
export type SetVisibilityInput = z.infer<typeof SetVisibilityInput>;

export const SignInOptions = z
  .object({
    devSignIn: z.boolean().meta({ description: "Dev sign-in by name is on: DEV_SIGN_IN=1 and a loopback host." }),
    linkedIn: z.boolean().meta({ description: "Sign In with LinkedIn is configured." }),
  })
  .meta({ id: "SignInOptions", description: "Which ways to sign in this server offers." });
export type SignInOptions = z.infer<typeof SignInOptions>;

export const DevSignInInput = z
  .object({ name: z.string().trim().min(1).max(100).meta({ example: "Jane Doe" }) })
  .meta({ id: "DevSignIn" });
export type DevSignInInput = z.infer<typeof DevSignInInput>;

const instant = z.string().meta({ description: "ISO-8601 UTC instant." });

export const AgentToken = z
  .object({
    id: z.string(),
    label: z.string(),
    prefix: z.string().meta({ description: "The secret's first characters, to tell tokens apart.", example: "hw_Ab3dE9xQ" }),
    createdAt: instant,
    lastUsedAt: instant.optional(),
    revokedAt: instant.optional(),
  })
  .meta({ id: "AgentToken", description: "A personal token an agent uses for MCP and REST. The secret is never shown again." });
export type AgentToken = z.infer<typeof AgentToken>;

export const AgentTokenList = z.object({ tokens: z.array(AgentToken) }).meta({ id: "AgentTokenList" });
export type AgentTokenList = z.infer<typeof AgentTokenList>;

export const IssuedAgentToken = z
  .object({
    token: AgentToken,
    secret: z.string().meta({ description: "Send as `Authorization: Bearer <secret>`. Shown once." }),
  })
  .meta({ id: "IssuedAgentToken" });
export type IssuedAgentToken = z.infer<typeof IssuedAgentToken>;

export const IssueAgentTokenInput = z
  .object({ label: z.string().trim().min(1).max(100).meta({ example: "Claude on my laptop" }) })
  .meta({ id: "IssueAgentToken" });
export type IssueAgentTokenInput = z.infer<typeof IssueAgentTokenInput>;

export const RevokeAgentTokenInput = z.object({ tokenId: z.string().min(1).max(64) });
export type RevokeAgentTokenInput = z.infer<typeof RevokeAgentTokenInput>;

export const CalendarFeed = z
  .object({
    token: z
      .string()
      .meta({ description: "The feed's secret, shown only to its owner. Rotating replaces it and the old URL stops working." }),
    path: z.string().meta({ example: "/cal/AbC.ics" }),
    rotatedAt: instant,
  })
  .meta({ id: "CalendarFeed", description: "My secret iCalendar URL." });
export type CalendarFeed = z.infer<typeof CalendarFeed>;
