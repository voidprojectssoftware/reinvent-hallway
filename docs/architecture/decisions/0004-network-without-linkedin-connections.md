# 0004. The network is ours; LinkedIn gives identity and seeds suggestions

Date: 2026-11-13. Status: accepted.

LinkedIn's Connections API is partner-only (`docs/discovery/linkedin.md`). The
owner asked for "an integration, if at all possible with LinkedIn, so you can see
where people in your network are going".

**Decision.**
- Sign-in is **Sign In with LinkedIn (OIDC)**. It verifies name, picture and
  email. A dev sign-in exists when `DEV_SIGN_IN=1` only, for local work and tests.
- Connections are Hallway's own, mutual, by request and accept, or at once via
  a share link (`domain.md`).
- **Suggestions** come from the user's uploaded `Connections.csv`. We keep only a
  normalized profile URL, a normalized name and a SHA-256 of the email, and drop
  everything else at parse time: it is data about people who never signed up.
- A claimed profile URL alone never produces a suggestion, because anyone can
  claim any URL; it needs the verified name or verified email to agree.

**Owner inputs needed before it is real:** a LinkedIn developer app (client id
and secret) under Void Projects. Until then the LinkedIn adapter is built and
tested against a fake.
