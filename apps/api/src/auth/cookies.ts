// The two cookies Hallway sets: the web session, and the short-lived OAuth
// state that binds a LinkedIn callback to the browser that started it.
//
// Both are HttpOnly and SameSite=Lax (Lax, not Strict, because the callback is
// a top-level navigation from linkedin.com, which must carry the state
// cookie). Both are Secure, except on plain http to a loopback host, which is
// what `npm run dev` serves: Safari and curl drop a Secure cookie there, and
// a dev server on 127.0.0.1 is reached by no one else. A deployed Worker is
// only ever https on a real hostname, so it always sets Secure.
import { isReturnPath } from "@hallway/contracts";
import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { isLoopback } from "./dev-sign-in.ts";

export const sessionCookie = "hallway_session";
export const oauthStateCookie = "hallway_oauth_state";
export const linkedInCallbackPath = "/api/auth/linkedin/callback";

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

// The state cookie also carries where to go once signed in, so the return
// path is bound to the same browser and the same sign-in as the state: a
// callback cannot be pointed somewhere else without the cookie, and a second
// tab's sign-in replaces both together. The state is base64url, so the first
// `|` divides them.
const returnSeparator = "|";

/** Ten minutes to finish at LinkedIn; scoped to the callback, the one path that reads it. */
export function setOAuthStateCookie(c: Context, state: string, returnTo = "/") {
  setCookie(c, oauthStateCookie, `${state}${returnSeparator}${returnTo}`, {
    httpOnly: true,
    secure: secure(c),
    sameSite: "Lax",
    path: linkedInCallbackPath,
    maxAge: 600,
  });
}

/**
 * Reads the state and its return path and deletes the cookie at once: a state
 * is good for one callback. The path is checked again on the way out (it was
 * checked on the way in): a Location header is no place to trust a cookie.
 */
export function takeOAuthStateCookie(c: Context): { state: string | undefined; returnTo: string } {
  const value = getCookie(c, oauthStateCookie);
  deleteCookie(c, oauthStateCookie, { path: linkedInCallbackPath, secure: secure(c), httpOnly: true, sameSite: "Lax" });
  if (value === undefined) return { state: undefined, returnTo: "/" };
  const at = value.indexOf(returnSeparator);
  const state = at === -1 ? value : value.slice(0, at);
  const returnTo = at === -1 ? "/" : value.slice(at + 1);
  return { state, returnTo: isReturnPath(returnTo) ? returnTo : "/" };
}
