# 0011. Bulk rows and long id lists go to D1 as one JSON parameter

Date: 2026-11-13. Status: accepted. Narrows ADR 0009 for one case.

A LinkedIn `Connections.csv` holds up to 30,000 rows (issue #15). ADR 0009's
multi-row inserts bind four parameters per contact, so 25 contacts a
statement: 1,200 statements for one import, past D1's 1,000 queries per
invocation on the paid plan and far past the free plan's 50.

**Decision.** When a write's row count is set by user data rather than by a
bounded list, the repository binds the rows as one JSON array per statement
and expands it in SQL:
`insert into imported_contacts (...) select ?, json_extract(value, '$[0]'), ... from json_each(?)`,
through Drizzle's `insert(table).select(sql)`, so the target columns still come
from the model. Each array is cut at `contactBytesPerStatement` (500,000
bytes, a quarter of D1's 2 MB limit on one string), and the statements go in
one `db.batch()` with the deletes before them, so a replacement is all or
nothing. 30,000 contacts are about 2 MB of JSON, so 3 + 4 statements; even
with an email on every row, about 3 + 8 (`network-repository.test.ts` counts
them, and fails past 50).

Reads that take a list of ids of unbounded length use the same shape,
`column in (select value from json_each(?))`: "who is going" over a page of
sessions is one statement with a fixed parameter count, not one per chunk.

**Why not ADR 0009's way here.** ADR 0009 rejected `json_each` for the sync
because its rows are few and a hand-written statement bypassed the models.
Here the row count is the user's, so per-row parameters cannot fit; the
`insert ... select` keeps the model for the column list, and only the
expansion is SQL.

**Rejected:** several invocations for one import (no longer atomic); a
Queue or Durable Object for the import (machinery for a once-a-week upload);
dropping rows that match no attendee today (an attendee who signs up next
week would never be suggested).
