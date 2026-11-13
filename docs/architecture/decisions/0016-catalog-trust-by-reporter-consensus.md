# 0016. The catalog is what reporters agree on, and a sync writes from what it sent

Date: 2026-11-13. Status: accepted. Issue #53; replaces ADR 0009's
read-merge-write for the sync and narrows ADR 0003's "the catalog is the union
of snapshots".

The agent-journey hunt (`docs/discovery/hunts/2026-11-13-agent-journey.md`)
showed that any attendee's agent could rewrite any session in the shared
catalog, its own or not (F6), and that a sync computed from an earlier read
could leave the union of two concurrent syncs or fail with a raw SQLite
constraint error (F4).

**Decision: catalog trust by reporter consensus.** A sync keeps a snapshot
only for a session in that sync's `favorites`, `reserved` or
`invitedSessions`. Each kept snapshot, merged forward over the attendee's own
earlier one, is that attendee's *report* (`session_reports`, one row per
attendee and session). The session everyone sees is, per field, the value the
most reports carry, a tie going to the value whose latest report is newest; a
start and its end are one vote. The domain states the rule (`consensus`); the
D1 repository materializes it into the `sessions` row with one `UPDATE` of
correlated `GROUP BY` subqueries inside the sync's own batch, so a read of a
session never touches reports (no N+1) and two reporters syncing at once both
count. `schedule-repository.test.ts` holds the SQL and the domain function (the
in-memory fake uses it) to the same answers.

**Decision: a sync's write is set-based.** The batch is built from what the
sync sent, never from entries read before it: delete the attendee's
`agent-sync` entries not in the sent list, lower `manual` entries not sent to
the attendee's own intent, then upsert the sent ones with `ON CONFLICT DO
UPDATE`. D1 runs a batch as one transaction, so concurrent syncs serialize and
the last one wins whole. The counts the sync returns still come from the
earlier read (`planSync`); they may be off by a race, the state may not.

**Same slice, recorded here:** hiding is a set of session ids per attendee
and event (`hidden_sessions`), not a column on the entry, so it outlives the
entry; the code, title and speakers are stored folded (`foldText`: NFKD, marks
stripped, Unicode lowercase) for search, since SQLite's `lower()` folds ASCII
only; and the sync's rows and id lists go in as `json_each` arrays (ADR 0011),
so a 1,000-session sync is seven statements rather than ADR 0009's two hundred.

**Rejected:** consensus computed on read (an N+1 over reports on every
schedule, search and feed); consensus computed in the handler from reports
read before the batch (simpler, but two attendees reporting at once would each
miss the other's vote until the next sync); refusing a report that disagrees
with the consensus (AWS does move sessions, and the honest majority must be
able to follow it); "never move a time by days" (a heuristic that blocks real
changes and lets small poisonings through).

**Cost:** consensus lives twice, in TypeScript and in SQL, held together by
the shared repository tests. Ties are decided by recency, so one honest
reporter and one who disagrees is a tie the newer report wins; two honest
reporters outvote one. Consensus protects a session only once someone else
has reported it.
`session_reports` grows with attendees times their sessions (bounded by
registered seats, about 60,000 people at re:Invent, each with tens of
sessions).
