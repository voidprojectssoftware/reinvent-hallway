# 0009. A multi-row D1 write is one batch of statements under 100 parameters

Date: 2026-11-13. Status: accepted.

D1 has no interactive transactions: `batch()` is the only all-or-nothing
write, and it binds at most 100 parameters per statement. A sync of 200
sessions writes about 200 session rows and 200 plan entries, and must land
whole or not at all (issue #13).

**Decision.** A repository method that writes many rows builds every statement
first, each kept under 100 parameters (multi-row inserts cut into chunks of
`floor(100 / columns)` rows, `IN (...)` lists cut to fit beside their other
parameters), and sends them in one `db.batch()`, ordered so referenced rows come
first. `scheduleOnD1().applySync` is the first; `D1_MAX_PARAMETERS` and `chunk`
live beside it until a second repository needs them. Its test wraps the D1
binding, counts parameters per statement and batches per call, and shows a
failing last statement rolls back the rest.

**Read-merge-write.** Snapshot merging (`mergeSnapshot`) happens in the handler
on rows read before the batch, so the batch writes whole rows. Two syncs of the
same session at once are last-writer-wins on that row; acceptable for catalog
snapshots, which converge on the next sync.

**Rejected:** one statement per row (a 200-session sync would be 400
statements, past D1's per-invocation query limit); a single
`INSERT ... SELECT FROM json_each(?)` with all rows in one parameter (one
statement, but hand-written SQL that bypasses the Drizzle models).

**Cost:** a 200-session sync is 44 statements in its batch; D1's limit on
queries per Worker invocation is 1,000 on the paid plan and 50 on the free one,
so a deployment on the free plan would cap a sync near 200 sessions.
