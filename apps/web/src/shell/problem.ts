// What to tell a person when something they did, or a screen they opened,
// did not work: what happened in plain words and what they can do next. A
// refusal a handler worded (a handle taken, a request already sent) is
// written for people and is shown as it is; what no handler said (no
// connection, a 500, an answer the contract does not describe, a validation
// dump) gets Hallway's own words. Status codes, paths and exception names go
// to the console, never to the screen.
import { ApiFailure } from "../api/client.ts";

export interface Problem {
  text: string;
  /** What to offer: try the same thing again, or sign in and come back. Nothing when only the person can fix it (bad input). */
  next: "retry" | "sign-in" | null;
}

export function describeProblem(failure: unknown): Problem {
  if (!(failure instanceof ApiFailure)) return { text: "Something went wrong. Try again.", next: "retry" };
  switch (failure.kind) {
    case "unreachable":
      return { text: "Hallway could not be reached. Check your connection and try again.", next: "retry" };
    case "unexpected":
      return { text: "Hallway had a problem. Try again in a moment.", next: "retry" };
    case "unauthenticated":
      return { text: "You are signed out. Sign in and you come back here.", next: "sign-in" };
    case "invalid":
      // The request parser's refusal is a serialized issue list, not a
      // sentence. TODO(#69): drop this once the API words it.
      return looksLikeData(failure.message)
        ? { text: "Hallway could not accept that. Check what you entered and try again.", next: null }
        : { text: failure.message, next: null };
    default:
      return { text: failure.message, next: null };
  }
}

/** The developer's half of a failure, for the console. */
export function problemDetail(failure: unknown): string {
  if (failure instanceof ApiFailure) return `${failure.kind}${failure.status ? ` (${failure.status})` : ""}: ${failure.message}`;
  return failure instanceof Error ? `${failure.name}: ${failure.message}` : String(failure);
}

const looksLikeData = (message: string) => /^\s*[[{]/.test(message);
