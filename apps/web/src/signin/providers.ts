// What the web says about each sign-in provider, and about a round trip that
// came back refused. The API puts only `?error=<kind>&provider=<p>` on the
// way back (ADR 0018, note of #60), so the words are the web's, written here
// once for the sign-in screen and Settings.
import { signInProviders, type ErrorKind } from "@hallway/contracts";
import type { SignInProvider } from "../api/client.ts";

/** The provider's own name, as its sign-in button says it. */
export const providerName: Record<SignInProvider, string> = {
  google: "Google",
  microsoft: "Microsoft",
  linkedin: "LinkedIn",
  github: "GitHub",
};

export const isProvider = (value: string | null): value is SignInProvider =>
  value !== null && (signInProviders as readonly string[]).includes(value);

/** A refused round trip, as the API's redirect names it. */
export interface Refusal {
  kind: string;
  provider: SignInProvider | null;
}

/** The `?error=&provider=` the API's redirect put on this page, or null when there is none. */
export function refusalOf(url: URL): Refusal | null {
  const kind = url.searchParams.get("error");
  if (kind === null) return null;
  const provider = url.searchParams.get("provider");
  return { kind, provider: isProvider(provider) ? provider : null };
}

/**
 * Why signing in did not work, in plain words, with what to do next.
 * `account-exists` has its own page and never reaches here.
 */
export function signInRefusalText({ kind, provider }: Refusal): string {
  const name = provider ? providerName[provider] : "that account";
  switch (kind as ErrorKind) {
    case "unauthenticated":
    case "invalid":
      return `${provider ? providerName[provider] : "The provider"} did not sign you in. Try again, or choose another way.`;
    case "forbidden":
      return "That sign-in took too long, or was started in another browser. Start again here.";
    case "not-found":
      return `Signing in with ${name} is not set up on this Hallway. Choose another way.`;
    default:
      return `Signing in with ${name} did not work. Try again in a moment.`;
  }
}

/** Why adding a provider in Settings did not work. */
export function linkRefusalText({ kind, provider }: Refusal): string {
  const name = provider ? providerName[provider] : "that account";
  switch (kind as ErrorKind) {
    // Settings offers Add only for a provider not linked yet, so the other
    // conflict (a different account of the same provider) needs a race.
    case "conflict":
      return `${provider ? `That ${name} account` : "That account"} already signs in to another Hallway account, so it was not added here. To use that account, sign out and sign in with ${provider ? name : "it"}.`;
    case "unauthenticated":
    case "invalid":
      return `${provider ? providerName[provider] : "The provider"} did not confirm your account, so nothing was added. Try again.`;
    case "forbidden":
      return "Adding it took too long, or you signed in as someone else meanwhile. Nothing was added. Try again.";
    case "not-found":
      return `Signing in with ${name} is not set up on this Hallway.`;
    default:
      return `Adding ${name} did not work. Try again in a moment.`;
  }
}
