# 0001. Enforcement layers

Date: 2026-11-13. Status: accepted.

Owned repository, private, in `voidprojectssoftware` (Team plan, so rulesets work).

- **Ruleset on `main`**: pull request required, required checks `checks` (CI,
  `npm run verify`) and `visual` (diagrams in the PR description). Kept: it is
  the only layer that refuses a direct push.
- **Merge wrapper** `scripts/merge-pr.mjs`: kept. It names the red check where
  the merge button does not, and writes the provenance trailer.
- **Guard hook** `scripts/guard-merge.mjs`: kept. A ruleset cannot stop an agent
  merging its own pull request; the hook refuses it.
- **Provenance audit** `scripts/check-main-provenance.mjs`: kept. Org admins can
  bypass the ruleset, and a bypass leaves no trace anywhere else.

**No owner gate** (void-crm's ADR 0002 has one on the domain and schema). The
owner asked for an MVP and said "I'm trusting you" on the model, so the factory
merges model changes too. Revisit when Hallway has real users' data.
