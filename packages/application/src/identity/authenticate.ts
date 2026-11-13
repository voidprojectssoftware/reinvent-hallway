// Turns a credential into an Actor (ADR 0002, "Auth is a port"). apps/api
// reads the credential off the request (session cookie, or agent token as a
// bearer) and asks this; handlers then see only the Actor, never the door.
import type { Actor } from "../actor.ts";
import { fail, ok, type Outcome } from "../outcome.ts";
import type { AgentTokenRepository, WebSessionRepository } from "./ports.ts";
import { sha256Hex } from "./secrets.ts";

export type Credential =
  | { kind: "session"; secret: string }
  | { kind: "agent-token"; secret: string };

export type Authenticate = (credential: Credential) => Promise<Outcome<Actor>>;

export function authenticate(
  sessions: WebSessionRepository,
  tokens: AgentTokenRepository,
  now: () => Date,
): Authenticate {
  return async (credential) => {
    const hash = await sha256Hex(credential.secret);
    const at = now().toISOString();

    if (credential.kind === "session") {
      const session = await sessions.byIdSha256(hash);
      if (!session || session.expiresAt <= at) {
        return fail("unauthenticated", "The session has ended. Sign in again.");
      }
      return ok({ kind: "attendee", attendeeId: session.attendeeId });
    }

    const token = await tokens.bySecretSha256(hash);
    if (!token || token.revokedAt) {
      return fail("unauthenticated", "The agent token is unknown or revoked.");
    }
    await tokens.touch(token.id, at);
    return ok({ kind: "attendee", attendeeId: token.attendeeId });
  };
}
