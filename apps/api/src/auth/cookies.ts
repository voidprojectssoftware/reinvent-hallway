// The two cookies Hallway sets: the web session, and the short-lived OAuth
// state that binds a provider's callback to the browser that started it.
//
// Both are HttpOnly and SameSite=Lax (Lax, not Strict, because the callback is
// a top-level navigation from the provider's site, which must carry the state
// cookie). Both are Secure, except on plain http to a loopback host, which is
// what `npm run dev` serves: Safari and curl drop a Secure cookie there, and
// a dev server on 127.0.0.1 is reached by no one else. A deployed Worker is
// only ever https on a real hostname, so it always sets Secure.
import { isReturnPath, type SignInProvider } from "@hallway/contracts";
import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { isLoopback } from "./dev-sign-in.ts";

export const sessionCookie = "hallway_session";
export const oauthStateCookie = "hallway_oauth_state";
/**
 * One callback path per provider. The state cookie is scoped to it, so a
 * cookie set for one provider never reaches another's callback, and which
 * provider answered is the path's word, never the cookie's.
 */
export const callbackPath = (provider: SignInProvider) => `/api/auth/${provider}/callback`;

function secure(c: Context): boolean {
  const url = new URL(c.req.url);
  return url.protocol === "https:" || !isLoopback(url.hostname);
}

export function setSessionCookie(c: Context, secret: string, expiresAt: string) {
  setCookie(c, sessionCookie, secret, {
    httpOnly: true,
    secure: secure(c),
    sameSite: "Lax",
    path: "/",
    expires: new Date(expiresAt),
  });
}

export const readSessionCookie = (c: Context) => getCookie(c, sessionCookie);

export function clearSessionCookie(c: Context) {
  deleteCookie(c, sessionCookie, { path: "/", secure: secure(c), httpOnly: true, sameSite: "Lax" });
}

// The state cookie also carries where to go once signed in, and, for a link
// round trip, the attendee it was started for. So the return path and the
// link are bound to the same browser and the same round trip as the state: a
// callback cannot be pointed somewhere else, or at someone else, without the
// cookie, and a second tab's start replaces all three together. The state is
// base64url and an attendee id a UUID, so the first two `|` divide them.
const separator = "|";

export interface OAuthStart {
  state: string;
  returnTo?: string | undefined;
  /** Set for a link round trip: the attendee signed in when it started. */
  linkFor?: string | undefined;
}

/** Ten minutes to finish at the provider; scoped to that provider's callback, the one path that reads it. */
export function setOAuthStateCookie(c: Context, provider: SignInProvider, start: OAuthStart) {
  const value = [start.state, start.linkFor ?? "", start.returnTo ?? "/"].join(separator);
  setCookie(c, oauthStateCookie, value, {
    httpOnly: true,
    secure: secure(c),
    sameSite: "Lax",
    path: callbackPath(provider),
    maxAge: 600,
  });
}

// Posting to LinkedIn (ADR 0026) is its own round trip, with its own cookie
// on its own callback path, so it never meets a sign-in's. The cookie holds
// the state and the composer page to come back to; the draft itself waits on
// the server, keyed by the state's hash.
export const postStateCookie = "hallway_post_state";
export const postCallbackPath = "/api/me/share/post/callback";

export function setPostStateCookie(c: Context, start: { state: string; returnTo: string }) {
  setCookie(c, postStateCookie, `${start.state}${separator}${start.returnTo}`, {
    httpOnly: true,
    secure: secure(c),
    sameSite: "Lax",
    path: postCallbackPath,
    maxAge: 600,
  });
}

/** The state and the way back, the cookie deleted at once; the path is checked again on the way out. */
export function takePostStateCookie(c: Context): { state: string | undefined; returnTo: string | undefined } {
  const value = getCookie(c, postStateCookie);
  deleteCookie(c, postStateCookie, { path: postCallbackPath, secure: secure(c), httpOnly: true, sameSite: "Lax" });
  const cut = value?.indexOf(separator) ?? -1;
  if (value === undefined || cut === -1) return { state: undefined, returnTo: undefined };
  const returnTo = value.slice(cut + 1);
  return { state: value.slice(0, cut), returnTo: isReturnPath(returnTo) ? returnTo : undefined };
}

/**
 * Reads the state, link and return path and deletes the cookie at once: a
 * state is good for one callback. The path is checked again on the way out
 * (it was checked on the way in): a Location header is no place to trust a
 * cookie.
 */
export function takeOAuthStateCookie(
  c: Context,
  provider: SignInProvider,
): { state: string | undefined; linkFor: string | undefined; returnTo: string } {
  const value = getCookie(c, oauthStateCookie);
  deleteCookie(c, oauthStateCookie, { path: callbackPath(provider), secure: secure(c), httpOnly: true, sameSite: "Lax" });
  if (value === undefined) return { state: undefined, linkFor: undefined, returnTo: "/" };
  const first = value.indexOf(separator);
  const second = first === -1 ? -1 : value.indexOf(separator, first + 1);
  if (second === -1) return { state: undefined, linkFor: undefined, returnTo: "/" };
  const linkFor = value.slice(first + 1, second);
  const returnTo = value.slice(second + 1);
  return {
    state: value.slice(0, first),
    linkFor: linkFor === "" ? undefined : linkFor,
    returnTo: isReturnPath(returnTo) ? returnTo : "/",
  };
}
