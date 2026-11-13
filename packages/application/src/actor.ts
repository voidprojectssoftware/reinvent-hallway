// Who is asking (ADR 0002, "Auth is a port"). Handlers receive an Actor and
// never see a cookie, a token or a header; apps/api resolves one per request.
export type Actor =
  | { kind: "attendee"; attendeeId: string }
  | { kind: "anonymous" };

export const anonymous: Actor = { kind: "anonymous" };
