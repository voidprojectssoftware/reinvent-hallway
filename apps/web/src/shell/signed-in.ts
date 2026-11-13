// Who is signed in, as a loader sees it. The server is the only judge: a
// call that needs a person answers `unauthenticated` when there is none, and
// these two turn that answer into what a screen does about it.
import { isReturnPath } from "@hallway/contracts";
import { redirect } from "react-router";
import { ApiFailure } from "../api/client.ts";

const signedOut = (failure: unknown) => failure instanceof ApiFailure && failure.kind === "unauthenticated";

/** For a screen that is only mine: signed out goes to the sign-in screen. */
export async function requireSignIn<T>(load: Promise<T>): Promise<T> {
  try {
    return await load;
  } catch (failure) {
    if (signedOut(failure)) throw redirect("/sign-in");
    throw failure;
  }
}

/** For a screen anyone may open: signed out is `null`, not a failure. */
export async function ifSignedIn<T>(load: Promise<T>): Promise<T | null> {
  try {
    return await load;
  } catch (failure) {
    if (signedOut(failure)) return null;
    throw failure;
  }
}

/** The sign-in screen, coming back to `path` once signed in (both ways of signing in honour it). */
export const signInPath = (path: string) => `/sign-in?returnTo=${encodeURIComponent(path)}`;

/**
 * Where to land once signed in, from the sign-in screen's `?returnTo=`, or
 * null for My week. Only a path on this site is kept (the contract's
 * `isReturnPath`, which the server applies again to LinkedIn's way back).
 */
export function returnPathOf(url: URL): string | null {
  const path = url.searchParams.get("returnTo");
  return path !== null && isReturnPath(path) ? path : null;
}
