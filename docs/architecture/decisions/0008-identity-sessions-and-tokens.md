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
- **The Actor says which door it came in by**: `via` is `session`,
  `agent-token` or `dev`. **An agent token may not manage credentials**:
  issuing, listing and revoking agent tokens, and rotating or reading the
  calendar feed, refuse `via: "agent-token"` with 403 `forbidden`, in the
  handler (`person-at-keyboard.ts`). Otherwise a stolen token could mint a
  fresh one, or copy the feed URL, and keep access after its own revocation.
  `dev` counts as a person, like `session`. Everything else an agent token may
  do as its attendee.
- **Every secret is 32 random bytes, base64url.** Session cookies and agent
  tokens (`hw_` prefixed) are stored as their SHA-256 and looked up by that
  hash, never by prefix; an agent token's secret is shown once. The OAuth
  state lives only in its cookie.
- **The calendar feed token is stored readable**, the one exception. Its
  owner must see the subscribe link again (`GET /api/me/calendar-feed`)
  without rotating, which would break calendars already subscribed. Hashing
  would protect nothing: whoever can read the database can read the schedules
  the feed serves. It is returned only to its owner, signed in as a person,
  and is in no other resource (not `Me`, not the attendee card) and no log.
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

Rejected: verifying the ID token (more code for no extra trust here);
hashing the calendar feed token (it forced a rotation just to see the link
again, and protected nothing the database did not already expose); letting
agent tokens manage tokens (a stolen token would outlive its revocation);
treating a bad session cookie as 401 (every page load of a signed-out
browser would fail).
