// Who is signed in, as a loader sees it. The server is the only judge: a
// call that needs a person answers `unauthenticated` when there is none, and
// these two turn that answer into what a screen does about it.
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
