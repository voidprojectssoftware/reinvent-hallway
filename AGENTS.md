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

`apps/api` (Worker: `/api` REST, `/mcp`, `/cal`, static web), `apps/web` (React
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
- **One visibility rule for every read path (domain.md).** _Held by:_ nothing yet.
- **No session abstract is stored or served (ADR 0003).** _Held by:_ the
  sessions table has no column for it and `toSession` never reads it;
  `schedule-repository.test.ts` fails on an abstract-like column, and
  `apps/api/src/schedule.test.ts` fails when any REST or MCP response carries
  the fixture's abstract text.

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
npm run verify   # ADR and script checks, typecheck, boundaries, tests: what CI runs
npm run dev      # the Worker with local D1, migrations applied first; prints its URL
```

`npm run dev` picks a port from this checkout's path (20000 to 29999, the next
free one if taken; `HALLWAY_PORT` overrides) and keeps D1 under this checkout's
`.wrangler/state`, so worktrees never share a port or a database. Read the URL
it prints; never assume 8787. Stop it by its own process (Ctrl-C, or the pid
you started), never with a pattern that matches other worktrees' servers.

- `GET /api/events/reinvent2026`, `GET /api/openapi.json`, MCP at `/mcp`
  (streamable HTTP, stateless).
- Dev sign-in, a stand-in until real sign-in lands: send
  `Authorization: Bearer dev:<attendeeId>`. It works only with
  `DEV_SIGN_IN=1` in `apps/api/.dev.vars` (copied from `.dev.vars.example` on
  first run) and only on a loopback host.
- `npm run db:generate -- <name>` writes the next migration from
  `packages/infrastructure/src/persistence/d1/entities/`; add `--custom` for a
  hand-written data migration. `npm run types -w @hallway/api` after changing
  `apps/api/wrangler.jsonc`.
