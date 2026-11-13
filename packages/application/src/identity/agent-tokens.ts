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
import { personAtKeyboard } from "./person-at-keyboard.ts";
import { randomSecret, sha256Hex } from "./secrets.ts";
import { toAgentToken } from "./views.ts";

export const agentTokenPrefix = "hw_";
/** How much of the secret the token's `prefix` shows: `hw_` and eight more. */
const shownLength = agentTokenPrefix.length + 8;

export type IssueAgentToken = (actor: Actor, input: IssueAgentTokenInput) => Promise<Outcome<IssuedAgentToken>>;
export type ListAgentTokens = (actor: Actor) => Promise<Outcome<AgentTokenList>>;
export type RevokeAgentToken = (actor: Actor, input: RevokeAgentTokenInput) => Promise<Outcome<AgentToken>>;

// Every handler here is for the person, never their agent (person-at-keyboard.ts).

export function issueAgentToken(tokens: AgentTokenRepository, now: () => Date): IssueAgentToken {
  return async (actor, { label }) => {
    const person = personAtKeyboard(actor);
    if (!person.ok) return person;
    const secret = agentTokenPrefix + randomSecret();
    const token: AgentTokenRecord = {
      id: crypto.randomUUID(),
      attendeeId: person.value,
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
    const person = personAtKeyboard(actor);
    if (!person.ok) return person;
    return ok({ tokens: (await tokens.listFor(person.value)).map(toAgentToken) });
  };
}

/** Revoking twice is not an error: the token stays revoked from the first time. */
export function revokeAgentToken(tokens: AgentTokenRepository, now: () => Date): RevokeAgentToken {
  return async (actor, { tokenId }) => {
    const person = personAtKeyboard(actor);
    if (!person.ok) return person;
    const token = await tokens.byId(tokenId);
    // Someone else's token answers exactly as a missing one, so ids cannot be probed.
    if (!token || token.attendeeId !== person.value) return fail("not-found", `No agent token ${tokenId}.`);
    if (token.revokedAt) return ok(toAgentToken(token));
    const revokedAt = now().toISOString();
    await tokens.revoke(token.id, revokedAt);
    return ok(toAgentToken({ ...token, revokedAt }));
  };
}
