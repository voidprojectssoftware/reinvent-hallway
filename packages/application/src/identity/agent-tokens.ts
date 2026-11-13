// IssueAgentToken, RevokeAgentToken and the list behind them (domain.md). A
// token is `hw_` plus 32 random bytes, base64url. Only its SHA-256 is kept,
// so the secret is in the issue response and nowhere else, ever.
import type {
  AgentToken,
  AgentTokenList,
  IssueAgentTokenInput,
  IssuedAgentToken,
  RevokeAgentTokenInput,
} from "@hallway/contracts";
import type { Actor } from "../actor.ts";
import { fail, ok, type Outcome } from "../outcome.ts";
import type { AgentTokenRecord, AgentTokenRepository } from "./ports.ts";
import { randomSecret, sha256Hex } from "./secrets.ts";
import { toAgentToken } from "./views.ts";

export const agentTokenPrefix = "hw_";
/** How much of the secret the token's `prefix` shows: `hw_` and eight more. */
const shownLength = agentTokenPrefix.length + 8;

export type IssueAgentToken = (actor: Actor, input: IssueAgentTokenInput) => Promise<Outcome<IssuedAgentToken>>;
export type ListAgentTokens = (actor: Actor) => Promise<Outcome<AgentTokenList>>;
export type RevokeAgentToken = (actor: Actor, input: RevokeAgentTokenInput) => Promise<Outcome<AgentToken>>;

const signInFirst = () => fail("unauthenticated", "Sign in first.");

export function issueAgentToken(tokens: AgentTokenRepository, now: () => Date): IssueAgentToken {
  return async (actor, { label }) => {
    if (actor.kind !== "attendee") return signInFirst();
    const secret = agentTokenPrefix + randomSecret();
    const token: AgentTokenRecord = {
      id: crypto.randomUUID(),
      attendeeId: actor.attendeeId,
      label,
      prefix: secret.slice(0, shownLength),
      secretSha256: await sha256Hex(secret),
      createdAt: now().toISOString(),
    };
    await tokens.create(token);
    return ok({ token: toAgentToken(token), secret });
  };
}

export function listAgentTokens(tokens: AgentTokenRepository): ListAgentTokens {
  return async (actor) => {
    if (actor.kind !== "attendee") return signInFirst();
    return ok({ tokens: (await tokens.listFor(actor.attendeeId)).map(toAgentToken) });
  };
}

/** Revoking twice is not an error: the token stays revoked from the first time. */
export function revokeAgentToken(tokens: AgentTokenRepository, now: () => Date): RevokeAgentToken {
  return async (actor, { tokenId }) => {
    if (actor.kind !== "attendee") return signInFirst();
    const token = await tokens.byId(tokenId);
    // Someone else's token answers exactly as a missing one, so ids cannot be probed.
    if (!token || token.attendeeId !== actor.attendeeId) return fail("not-found", `No agent token ${tokenId}.`);
    if (token.revokedAt) return ok(toAgentToken(token));
    const revokedAt = now().toISOString();
    await tokens.revoke(token.id, revokedAt);
    return ok(toAgentToken({ ...token, revokedAt }));
  };
}
