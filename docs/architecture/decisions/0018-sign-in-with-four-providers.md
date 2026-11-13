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
