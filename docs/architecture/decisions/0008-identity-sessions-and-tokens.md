# 0008. Identity: sessions, agent tokens, and the LinkedIn flow

Date: 2026-11-13. Status: accepted. Replaces the dev sign-in part of ADR 0006.

Issue #12 built sign-in (ADR 0004) and the actor resolver ADR 0002 asked for.
These are the choices it made that neither ADR fixed.

- **One resolver, three doors** (`apps/api/src/auth/resolve-actor.ts`). A
  `Bearer hw_...` is an agent token; a `Bearer dev:<attendeeId>` is believed
  only where dev sign-in is allowed; any other bearer is refused. Without a
  bearer, the `hallway_session` cookie is used, and an ended or unknown
  session is **anonymous, not an error**, so a stale cookie never breaks a
  public page. The lookups themselves are an application handler,
  `identity.authenticate`, so the resolver only reads headers.
- **Every secret is 32 random bytes, base64url, stored as its SHA-256 and
  looked up by that hash**: session cookie, agent token (`hw_` prefixed),
  calendar feed token, OAuth state. Nothing is looked up by prefix. So the
  calendar feed URL, like an agent token, is shown once, on rotation.
- **The LinkedIn callback is bound to the browser by `state`** in a
  `hallway_oauth_state` cookie (HttpOnly, SameSite=Lax, ten minutes, path
  limited to the callback, deleted on first read). A callback without the
  matching cookie is refused (403). **No PKCE**: LinkedIn offers it to native
  apps only; ours is a confidential client and the secret stays server side.
- **Identity comes from userinfo, not the ID token.** The access token is
  redeemed server to server over TLS, so userinfo gives the same claims
  without JWKS fetching and JWT checks to get wrong. `email` is kept only when
  `email_verified` is true.
- **Cookies are Secure except on plain http to a loopback host**, which is
  what `npm run dev` serves: Safari and curl drop Secure cookies there. A
  deployed Worker is https on a real hostname, so it always sets Secure.
- **Identity handlers are one entry, `handlers.identity`**, built by
  `identityHandlers(ports)`, so parallel slices each add one line to
  `Handlers`. `infrastructure`'s `identityInMemory()` gives tests every port.

Rejected: verifying the ID token (more code for no extra trust here); storing
the calendar feed token readable (a database leak would then expose feeds);
treating a bad session cookie as 401 (every page load of a signed-out
browser would fail).
