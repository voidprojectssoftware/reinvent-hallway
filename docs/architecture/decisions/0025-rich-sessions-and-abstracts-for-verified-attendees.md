# 0025. Keep what attendees' agents send of a session; abstracts only for verified attendees

Date: 2026-11-13. Status: accepted. Issue #74; amends ADR 0003 ("we keep no
abstracts").

The owner, 2026-11-13: "can we make it where we get as much information about
a session as we can from the attendee submitting it to us so we can render
meaningful information?" ADR 0003 had dropped the abstract and every taxonomy
but `topics` at the contract boundary.

## What the published terms say (researched 2026-11-13; not legal advice)

- **The AWS Events API developer guide** publishes no use or redistribution
  terms. It says the API "does not expose other attendees" and that
  reservations follow AWS event policies.
- **The AWS Event Terms** (https://aws.amazon.com/events/terms/, updated
  2026-01-07) contain no clause restricting reproducing the agenda.
- **The AWS Site Terms** (https://aws.amazon.com/terms/) say AWS site content
  "may not be reproduced, duplicated, copied, sold, resold… or otherwise
  exploited for any commercial purpose", and prohibit "data mining, robots".
  They cover the website, not the API, and Hallway does not scrape. But
  publishing catalog text wholesale and publicly is the reading to avoid.
- **The catalog is gated by design:** re:Invent's session catalog is not
  public; reading it needs an attendee who has signed in and is registered.

## Decision

1. **Keep every field of AWS's `Session` an agent sends**, per the committed
   spec: `abstract`, `type`, `level`, `venue`, `room`, `isAllDaySession`,
   `speakers`, and the lists `tracks`, `topics`, `industries`,
   `areasOfInterest`, `roles`, `services`, `segments`, `features`,
   `customerPersonas`, `experiences`, `additionalActivities`, `focusAreas`.
   **Not** `seatAvailability` or `isReservable`: they are AWS's live state,
   and a snapshot would show them stale. Each is a column on `sessions` and
   `session_reports` (lists as JSON arrays, as speakers already were).
2. **Everything but the abstract is shown to anyone who can see the session**,
   on the Session screen and in the `Session` resource; search filters on
   `type`, `level`, `topic`, `track` and `service`, each an exact value.
3. **The abstract is for verified attendees only: `canReadAbstract(reader)`
   in the domain.** A reader is verified when they are signed in (a person or
   their agent token) and some sync of theirs kept one of their own sessions
   of the event as their report. That sync is the proof AWS let them read the
   catalog. A sync whose snapshots were all dropped (none on the sender's own
   schedule) proves nothing and verifies no one.
4. **Only search and get may carry it**: `GET /api/events/{e}/sessions`,
   `GET /api/events/{e}/sessions/{id}`, and MCP `search_sessions` and the new
   `get_session`, to a verified reader. Never a schedule, a person's week, who
   is going, the network agenda, meeting gaps, connections, a sync or plan
   result, the link preview, the share image or the calendar feed, whoever
   asks (the owner included). Held by construction: the repository's
   `CatalogSession` has no abstract, every read of a session selects
   `catalogColumns` (all but the abstract), and one method, `abstracts`, reads
   it, called only by the two handlers after asking the rule. Held by test:
   `apps/api/src/schedule.test.ts` runs every REST and MCP read for a verified
   reader, an attendee who never synced, one whose sync kept nothing, and a
   signed-out caller; `sharing.test.ts` checks the card's drawn text, the link
   preview and the feed of a verified owner; the e2e suite does the same
   against the real Worker.
5. **Consensus (ADR 0016) covers the new fields**: the abstract and each list
   are one vote each, a list voted on whole (`["A","B"]` and `["B","A"]` are
   different values). Search never matches on the abstract, which would tell
   an unverified asker what it says.
6. **Rendered as text.** The abstract is plain text from AWS; the web renders
   it as a text node, never as HTML.

## Cost

- **Size.** The abstract is the largest field. A sync's rows go in as JSON
  chunks of at most 500,000 bytes (ADR 0011); an absent field is now left out
  of the JSON rather than written as `null`. A 250-session sync with a
  1,200-character abstract and three values in each of the twelve lists is
  one batch of 9 statements (two chunks each for catalog rows and reports),
  every statement under D1's 100 parameters
  (`schedule-repository.test.ts`); a 1,000-session sync without abstracts is
  still 7. Measured under `npm run dev` in the PR for #74.
- **Storage.** Every reporter's report keeps its own copy of the abstract, so
  the consensus can be computed in SQL. At about 1.5 KB a report and tens of
  sessions per attendee, 60,000 attendees would be a few GB of D1, inside its
  10 GB limit but its largest table by far.
- **The rule trusts a sync.** An agent token can send sessions it made up and
  so verify its attendee without AWS. What it can then read is other
  attendees' reports of abstracts, which AWS shows any registered attendee;
  Hallway never makes the text public. Tightening this (for example, needing
  two syncs a day apart, or a session others also reported) is open.

**Rejected:** showing the abstract to every signed-in user (signing in to
Hallway proves nothing about AWS registration); showing it publicly (the Site
Terms reading above); keeping only the abstract the reader's own agent sent
(an attendee could read abstracts only of sessions already on their schedule,
which is the least useful case); a separate table for abstracts (the consensus
would need its own vote and its own batch statements for no gain over a column
no read selects).
