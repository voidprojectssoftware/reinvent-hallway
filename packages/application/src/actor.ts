// Who is asking (ADR 0002, "Auth is a port"). Handlers receive an Actor and
// never see a cookie, a token or a header; apps/api resolves one per request.
//
// `via` is the door the attendee came in by. Handlers almost never care; the
// ones that manage credentials do (ADR 0008): an agent token may act as its
// attendee but may not issue, list or revoke tokens or touch the calendar
// feed, so a stolen token cannot outlive its own revocation. "dev" is dev
// sign-in's bearer and counts as a person at the keyboard, like "session".
export type ActorVia = "session" | "agent-token" | "dev";

export type Actor =
  | { kind: "attendee"; attendeeId: string; via: ActorVia }
  | { kind: "anonymous" };

export const anonymous: Actor = { kind: "anonymous" };
