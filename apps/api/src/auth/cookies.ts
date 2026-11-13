// The two cookies Hallway sets: the web session, and the short-lived OAuth
// state that binds a LinkedIn callback to the browser that started it.
//
// Both are HttpOnly and SameSite=Lax (Lax, not Strict, because the callback is
// a top-level navigation from linkedin.com, which must carry the state
// cookie). Both are Secure, except on plain http to a loopback host, which is
// what `npm run dev` serves: Safari and curl drop a Secure cookie there, and
// a dev server on 127.0.0.1 is reached by no one else. A deployed Worker is
// only ever https on a real hostname, so it always sets Secure.
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

/** Ten minutes to finish at LinkedIn; scoped to the callback, the one path that reads it. */
export function setOAuthStateCookie(c: Context, state: string) {
  setCookie(c, oauthStateCookie, state, {
    httpOnly: true,
    secure: secure(c),
    sameSite: "Lax",
    path: linkedInCallbackPath,
    maxAge: 600,
  });
}

/** Reads the state and deletes it at once: a state is good for one callback. */
export function takeOAuthStateCookie(c: Context): string | undefined {
  const state = getCookie(c, oauthStateCookie);
  deleteCookie(c, oauthStateCookie, { path: linkedInCallbackPath, secure: secure(c), httpOnly: true, sameSite: "Lax" });
  return state;
}
