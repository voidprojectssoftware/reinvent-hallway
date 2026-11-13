# 0018. Sign in with Google, Microsoft, LinkedIn or GitHub, and link them to one person

Date: 2026-11-13. Status: accepted, not yet built (#60, #61).

The owner, 2026-11-13: "They will need to be able to sign in with google,
microsoft, linkedin, or github."

## Decision

- **An attendee has one or more Identities**, one per provider at most:
  `provider` (`google` | `microsoft` | `linkedin` | `github`), `subject` (the
  provider's stable user id: OIDC `sub`, GitHub's numeric id, never a login or an
  email), `email` and `emailVerified` as the provider states them, `username`
  (GitHub login only), `linkedAt`. Unique on (`provider`, `subject`).
- **Providers.** Google, Microsoft (Entra ID, `common` tenant so work and
  personal accounts both work) and LinkedIn are OpenID Connect: authorization
  code, confidential client, state bound to a cookie (ADR 0008), identity from the
  ID token or userinfo. GitHub is OAuth 2 (not OIDC): identity from `GET /user`,
  emails from `GET /user/emails` (`user:email` scope) with GitHub's own
  `verified` flag. One adapter per provider behind one port, each tested
  against a fake of that provider; no test calls a real one.
- **Microsoft's `email` is not proof.** Entra lets a tenant admin set any
  address. Treat a Microsoft email as verified only when the `xms_edov` claim is
  true or the account is a personal Microsoft account; otherwise store it as
  unverified.
- **Linking is explicit.** A signed-in person adds another provider from
  Settings; the callback attaches the identity to the signed-in attendee. If that
  identity already belongs to another attendee, it is refused with a message
  saying so (no silent merge). Unlinking is allowed while another identity
  remains.
- **No merge by email.** Signing in with a new provider whose verified email
  equals an existing attendee's verified email does not sign in to that account
  and does not create a second one. It shows: "There is already a Hallway
  account for this email. Sign in the way you did before, then add <provider> in
  Settings." An email is not proof that the two accounts are the same person
  (shared mailboxes, reassigned work addresses).
- **`verifiedName`** comes from the first identity; GitHub's `name` may be null,
  in which case the login is used. Suggestions (ADR 0004) match an imported
  email against **any** verified identity email.
- **`GET /api/auth/options`** lists the providers that are configured, so the
  sign-in screen only shows working buttons.

## Owner inputs

An OAuth client for each of Google, Microsoft and GitHub (and LinkedIn, #18),
asked for in #62. Until then each is proven against its fake, and dev sign-in
stays the local way in.

## Note, 2026-11-13: as built (#60)

Built as written. Where the ADR left a choice open, #60 took these; none
changes a decision above.

- **One port, four adapters, one shared half.** `oauth-client.ts` is the
  authorization code flow every provider shares; Google and LinkedIn read
  userinfo (`oidc-userinfo.ts`), GitHub reads `/user` and `/user/emails`.
  Each has its fake (`fake-<provider>.ts`, over `fake-oauth-server.ts`).
- **Microsoft reads the ID token, not userinfo** (ADR 0008 chose userinfo).
  Microsoft's userinfo leaves out `tid` and `xms_edov`, the two claims this
  ADR's email rule needs. The ID token comes server to server in the token
  response, so TLS vouches for it as it does for userinfo; its `aud` and
  `iss` are still checked. The app registration must add `xms_edov` as an
  optional claim (owner input, #62).
- **Identities belong to the Attendee aggregate**: the attendee repository
  stores them (`identities` table, keyed on `(provider, subject)`, unique on
  `(attendee, provider)`), and an attendee is created with its first identity
  in one batch. Migration `0010_add_identities` moved `attendees.linkedin_sub`
  into identity rows and dropped it, with `verified_email_sha256`, which is
  now per identity.
- **Dev sign-in is an identity too**, provider `dev`, subject the normalized
  name, so `ListIdentities` and the last-one rule cover dev accounts. It is
  never offered as a provider and cannot be unlinked by route.
- **A link is bound to the person who started it**: the state cookie
  (`<state>|<attendee>|<returnTo>`, scoped to that provider's callback path)
  carries the attendee, and the callback refuses unless the same person is
  still signed in. The email rule applies to sign-in only: linking is the
  person's explicit act.
- **A refused callback redirects**, since it is a browser navigation: to
  `/sign-in?error=<kind>&provider=<p>` (keeping `returnTo`) after a sign-in,
  or to the link's `returnTo` with the same parameters. The email refusal is
  error kind `account-exists` (409 elsewhere), for #61's page.
- **`GET /api/auth/options`** gains `providers` (in the order Google,
  Microsoft, LinkedIn, GitHub) and keeps `linkedIn` until #61 reads
  `providers`.
- **The first identity's facts are the attendee's**: signing in with it
  refreshes `verifiedName`, `email` and the picture; another identity only
  fills a missing picture.
- **GitHub following** is read at sign-in and link time and handed to
  `recordGitHubFollowing`, a no-op until #63. It stops after 40 pages (4,000
  people), to stay inside a Worker's 50 subrequests on the free plan.
