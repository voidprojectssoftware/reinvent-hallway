# 0015. The way back from sign-in is a checked path in the OAuth state cookie

Date: 2026-11-13. Status: accepted. Extends ADR 0008's LinkedIn flow.

Issue #46: a visitor who opens `/@handle?invite=...` signed out must land on
that page again after LinkedIn. The web app used to hold the path in
`sessionStorage` and have `/` send it back, which failed in any other tab.

**Decision.** `GET /api/auth/linkedin?returnTo=<path>` takes the page to come
back to. It is written into the `hallway_oauth_state` cookie beside the state
(`<state>|<path>`), so it has the cookie's binding: this browser, this
sign-in, ten minutes, one use. The callback redirects there, or to `/`.

**The rule** is one function, `isReturnPath` in `packages/contracts`, used by
the route's query schema (`ReturnPath`), by the callback when it reads the
cookie back, and by the web's sign-in screen (`?returnTo=` there drives dev
sign-in and an already-signed-in visitor). A return path starts with exactly
one `/`; holds no backslash and no control character (URL parsers drop tabs
and newlines, which can turn `/\t/host` into `//host`); stays so after every
round of percent-decoding (`/%2F%2Fhost`, `/%5Chost`, `%252F`), with a
malformed escape refused; and resolves to the same origin. Anything else is
400 `invalid` before the browser is sent to LinkedIn, so no state is made.

**The invite token never rides in `returnTo`.** It stays in the tab's
`sessionStorage` (`apps/web/src/invite.ts`), so it does not reach LinkedIn,
a cookie or a log. Only the path `/@handle` goes through sign-in.

**Rejected:** a second cookie for the path (two cookies can drift; one is
bound by construction); signing or encrypting the path (the cookie is
HttpOnly and set by us, and the path is checked again on the way out, which
covers tampering); passing `returnTo` through LinkedIn's `state` parameter
(it would leave Hallway and come back in a URL); silently falling back to `/`
on a bad path at the start (a refusal is testable and tells the caller why).
