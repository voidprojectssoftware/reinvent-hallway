// The invite in a share link (/@handle?invite=<token>), from the moment the
// link is opened until it connects someone, and where to come back to after
// signing in.
//
// The token is a secret: whoever has it may connect to its owner (domain.md,
// "A connection is mutual and needs consent"). So it leaves the address bar
// as soon as the page reads it, before anything renders, and waits in this
// tab's sessionStorage instead: not in the URL, where it would sit in history
// and be copied with the address; not in a loader's data or a log. It must be
// kept somewhere that outlives a page load, because signing in with LinkedIn
// leaves the app and comes back to `/` (the callback takes no return path:
// #46 asks for one).
//
// sessionStorage can be missing or refuse (a private window, blocked site
// data); then the invite is simply not held, and the page offers a plain
// connection request instead.

const inviteKey = "hallway.invite";
const returnKey = "hallway.after-sign-in";

interface Held {
  handle: string;
  token: string;
}

function read(key: string): string | null {
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value === null) window.sessionStorage.removeItem(key);
    else window.sessionStorage.setItem(key, value);
  } catch {
    // Not held: see the note at the top.
  }
}

/**
 * Takes the invite out of a /@handle URL and holds it for that handle.
 * Returns the URL to replace this one with, or null when it carried none.
 */
export function holdInviteFrom(url: URL, handle: string): string | null {
  const token = url.searchParams.get("invite");
  if (token === null) return null;
  if (token !== "") write(inviteKey, JSON.stringify({ handle, token } satisfies Held));
  const clean = new URL(url);
  clean.searchParams.delete("invite");
  return clean.pathname + clean.search + clean.hash;
}

/** The invite held for this handle, if the link that brought me here had one. */
export function heldInvite(handle: string): string | null {
  const text = read(inviteKey);
  if (!text) return null;
  try {
    const held = JSON.parse(text) as Partial<Held>;
    return held.handle === handle && typeof held.token === "string" ? held.token : null;
  } catch {
    return null;
  }
}

/** Once it has connected us, or turned out stale, or is no use (my own page, already connected). */
export function dropInvite(): void {
  write(inviteKey, null);
}

/** Come back to this page after signing in. Only a path on this app: never another origin. */
export function returnAfterSignIn(path: string): void {
  if (isAppPath(path)) write(returnKey, path);
}

/** Where to go once signed in, if a page asked; asked once, then forgotten. */
export function takeReturnPath(): string | null {
  const path = read(returnKey);
  write(returnKey, null);
  return path !== null && isAppPath(path) ? path : null;
}

const isAppPath = (path: string) => path.startsWith("/") && !path.startsWith("//") && !path.startsWith("/\\");
