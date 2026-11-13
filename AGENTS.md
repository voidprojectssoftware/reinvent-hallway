# Hallway

See where the people you know will be at AWS re:Invent 2026, and let your agent
plan around them. Attendees' agents push their AWS favorites and reservations in
over MCP; the web app shows schedules, who is going to what, and share links.

Repository: `voidprojectssoftware/reinvent-hallway`, private. Not deployed:
**adding a deploy workflow or running `wrangler deploy` needs the owner.**

## Read first

1. This file.
2. `docs/architecture/domain.md` (resources, commands, queries, rules), then
   the ADRs in `docs/architecture/decisions/`.
3. `docs/discovery/aws-events-api.md` and `docs/discovery/linkedin.md` when your
   work touches either.
4. `docs/process/working-an-issue.md` and `docs/process/review.md`.
5. Your issue and its epic.

## Layout (ADR 0002)

`apps/api` (Worker: `/api` REST, `/mcp`, `/cal`, `/og` share cards, `/@handle` link previews, static web), `apps/web` (React
SPA, ADR 0005), `packages/contracts` (zod resources), `packages/domain` (rules,
imports nothing outside itself), `packages/application` (handlers over
repository ports), `packages/infrastructure` (D1 repositories and in-memory
fakes). REST routes and MCP tools hold no logic; they parse with a contract,
call a handler, map its outcome.

## Invariants

Each says what holds it. "Nothing yet" means review is the only thing holding it.

- **Nothing lands on `main` except through a pull request with `checks` and
  `visual` green.** _Held by:_ the ruleset on `main` (ADR 0001);
  `scripts/check-main-provenance.mjs` on every push.
- **Agents push a branch, open a PR, report, and stop.** _Held by:_
  `scripts/guard-merge.mjs` (hook); landing is `node scripts/merge-pr.mjs <n>`.
- **Every PR changing the model, a handler, a route, a tool or a screen carries
  a Mermaid diagram (screens: a screenshot) in its description.** _Held by:_ the
  `visual` check, `scripts/check-pr-visual.mjs`.
- **ADR numbers are unique.** _Held by:_ `scripts/check-adr-numbers.mjs`.
- **Layer boundaries (ADR 0002).** _Held by:_ `npm run boundaries`
  (dependency-cruiser, `.dependency-cruiser.mjs`) in `npm run verify`;
  `scripts/boundaries.test.mjs` proves each rule fails on a violation.
- **One visibility rule for every read path (domain.md).** _Held by:_
  every read of another attendee's entries filters them through the domain's
  `visibleEntries` (`packages/application/src/network/schedules.ts`), with
  the tie from `tieBetween` (connected, followed by the owner: ADR 0019), the
  one network repository lookup wired in `apps/api/src/index.ts`;
  and `apps/api/src/network.test.ts` ("every read of someone else's schedule
  goes through the visibility rule"), which runs each REST and MCP read path
  (person schedule, attendee card, who is going and its intents, network
  agenda, session search and get, connection counts, meeting gaps) against a private attendee, a non-connection
  and a hidden entry, and `apps/api/src/follows.test.ts` runs them for follows
  (following someone never shows you their week; their following you does).
  A new read path adds its case there. What leaves
  Hallway (calendar feed, share image, link preview) goes through
  `shareableEntries` with the same `tieBetween`, held by
  `apps/api/src/sharing.test.ts` and `person-page.test.ts` (ADR 0012).
- **No image URL is both the public card and the owner's picture (#70, ADR
  0026).** _Held by:_ `/og/{handle}.png` reads as `anonymous` whatever the
  request carries (`routes/sharing.ts`), and the owner's picture is
  `/api/me/share-image.png`; `sharing.test.ts` ("no image URL gives the
  owner's week to anyone else") fetches every image URL the owner is handed
  without credentials.
- **No LinkedIn token is stored, and only a person posts (ADR 0026).** _Held
  by:_ the token lives in `linkedInPoster`'s closure and no repository has a
  column for it; `apps/api/src/post.test.ts` checks no token reaches a draft
  or a redirect, and refuses an agent token on every posting route.
- **A session abstract reaches only a verified attendee, and only through
  session search and get (ADR 0025).** Verified is the domain's
  `canReadAbstract`: signed in, and a sync of theirs kept one of their own
  sessions. _Held by:_ `CatalogSession` has no abstract and every read of a
  session selects `catalogColumns`, so only the repository's `abstracts`
  reads it, called by the search and get handlers after asking the rule;
  `schedule-repository.test.ts` checks every other repository read leaves it
  out; `apps/api/src/schedule.test.ts` runs search and get over REST and MCP
  for a verified reader, one who never synced, one whose sync kept nothing and
  a signed-out caller, and every other REST and MCP read for a verified one;
  `sharing.test.ts` and the e2e suite check the share card, the link preview
  and the calendar feed. A new read path that returns sessions adds its case
  there.

## Enforcement layers

Ruleset, merge wrapper, guard hook, provenance audit: all four, ADR 0001.
`node scripts/check-setup.mjs` reports them; `node scripts/guard-merge.mjs --probe`
asks whether the guard is loaded in your session.

## Backlog

GitHub issues on this repository. Every issue carries a type label (`bug`,
`enhancement`, `documentation`, `chore`, `question`) and an area label.
`needs-owner` marks a question only the owner can answer; `needs-refinement`
marks work not ready to dispatch.

## Running things

Node 22.18 or later. From the root of your checkout:

```bash
npm ci
npm run verify   # ADR and script checks, typecheck, boundaries, tests, e2e: what CI runs
npm run test:e2e # two scripted agents against the real Worker (e2e/, review.md Lens 1)
npm run dev      # the Worker with local D1, migrations applied first; prints its URL
npm run aspire   # the same under Aspire, with demo data and a dashboard; prints every URL
```

Two ways to run it locally; both work from any worktree at once.

**`npm run aspire`** (ADR 0017; needs the Aspire CLI 13.5, `~/.aspire/bin/aspire`,
no .NET SDK) runs `aspire start --isolated` on `apphost.mts`, waits until the
demo data is in, and prints the dashboard's sign-in link and every resource's
URLs. Resources: `web` (the `vite build --watch`), `api` (wrangler dev; links
to the app, `/api/docs` and `/api/openapi.json`), `seed` (`npm run seed:demo`,
idempotent, so it runs on every start) and, in LAN mode, `lan`. Every port is
Aspire's; D1 and wrangler's files live under `.state/` (delete it to reset).
`npm run aspire:stop` stops it (`aspire stop --apphost apphost.mts`). Dev sign-in
as "Blake Hastings" to see the seeded week.

**LAN mode** is for a person on another machine: `HALLWAY_LAN=1 npm run aspire`
adds `lan`, a proxy on `0.0.0.0:${HALLWAY_LAN_PORT:-8796}` that presents each
request to the Worker as a loopback one (dev sign-in and cookies trust only
loopback, ADR 0008), and puts the dashboard on
`0.0.0.0:${HALLWAY_LAN_DASHBOARD_PORT:-8797}`. The printed links use this
machine's LAN address (`HALLWAY_LAN_HOST` overrides it); the dashboard link
carries this run's sign-in token. Never on unless asked. Several agents run
servers here: pick LAN ports nobody else uses, and never stop what you did not
start.

`npm run fake:linkedin` runs a fake LinkedIn on 127.0.0.1 and prints the
`.dev.vars` lines (client id and secret, `LINKEDIN_POSTING=1`,
`LINKEDIN_FAKE_URL`) that point sign-in and posting at it; restart
`npm run dev` after adding them. Its own page shows every post with its
picture. Nothing reaches LinkedIn (ADR 0026).

`npm run seed:demo -- <url>` loads the same demo data into a running
`npm run dev` (it needs dev sign-in, so a loopback URL).

`npm run dev` picks a port from this checkout's path (20000 to 29999, the next
free one if taken; `HALLWAY_PORT` overrides) and keeps D1 under this checkout's
`.wrangler/state`, so worktrees never share a port or a database. Read the URL
it prints; never assume 8787. Stop it by its own process (Ctrl-C, or the pid
you started), never with a pattern that matches other worktrees' servers.

- The web app is at `/` on the same origin. `npm run dev` builds `apps/web`
  first and rebuilds it on every change (no hot reload: reload the page;
  ADR 0010). `/sign-in` is the sign-in screen.
- `GET /api/events/reinvent2026`, `GET /api/openapi.json`, the API reference
  at `/api/docs` (Scalar), MCP at `/mcp` (streamable HTTP, stateless).
- Signing in locally (ADR 0008): `curl -c jar.txt -H 'content-type:
  application/json' -X POST <url>/api/dev/sign-in -d '{"name":"Jane Doe"}'`
  sets the session cookie; then `curl -b jar.txt <url>/api/me`. An agent
  token from `POST /api/me/tokens` goes in `Authorization: Bearer hw_...` on
  `/api` and `/mcp`. `Authorization: Bearer dev:<attendeeId>` still acts as
  that attendee without a sign-in. `POST /api/dev/github` with
  `{ "id": 1001, "login": "jane", "following": [{ "id": 1002, "login": "sam" }] }`
  links that GitHub account and who it follows to the person signed in, as a
  GitHub round trip would (follows, ADR 0019). Dev sign-in, the `dev:` bearer
  and `/api/dev/github` work only
  with `DEV_SIGN_IN=1` in `apps/api/.dev.vars` (copied from
  `.dev.vars.example` on first run) and only on a loopback host. Each of
  Google, Microsoft, LinkedIn and GitHub sign-in answers 404 until its
  `<PROVIDER>_CLIENT_ID` and `<PROVIDER>_CLIENT_SECRET` are set there
  (ADR 0018); each is tested against its fake in
  `packages/infrastructure/src/identity/fake-*.ts`, never a real provider. In application tests, build an `Actor` directly:
  `{ kind: "attendee", attendeeId, via: "session" }`. An agent token
  (`via: "agent-token"`) is refused (403) on token management and the
  calendar feed, so get those with the cookie, not the token.
- `npm run db:generate -- <name>` writes the next migration from
  `packages/infrastructure/src/persistence/d1/entities/`; add `--custom` for a
  hand-written data migration. `npm run types -w @hallway/api` after changing
  `apps/api/wrangler.jsonc`.
