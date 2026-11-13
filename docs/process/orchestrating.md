# Orchestrating Hallway

Written at setup (2026-11-13) from what setup cost. Revise it from what the loop
teaches, and say what you saw when you change it.

## The shape here

- Owned, ours. Backlog: GitHub issues. Dispatch: Claude Code subagents in
  worktrees. Machine facts: `.git/factory/machine.md`; handoff: the factory home
  named in `.git/factory-home`.
- No owner gate (ADR 0001): the factory merges model changes too.
- The ruleset requires a PR with `checks` and `visual` green, so process docs go
  through PRs as well.
- Briefs live in the issue; the dispatch message points at it. An agent that
  compacts can find its brief again.

## Traps already sprung

- **Setup commits pushed straight to `main` sit above any baseline set inside
  them.** The provenance baseline cannot name the commit that sets it, so the
  first PR moves it to the last direct push (`af66af3`), which is the commit
  before the ruleset was applied. That is the only time it moves.
- **Wave 1 had to be split by directory, not by layer.** The scaffold owns the
  root `package.json` and lockfile; the domain agent was confined to
  `packages/domain/` with no dependencies; the design agent to `docs/design/`.
- Hot files for every later wave: root `package.json`, `package-lock.json`,
  `AGENTS.md` "Running things", the contracts index, the route and tool
  registries, the migrations directory. Assign migration numbers in the brief.
