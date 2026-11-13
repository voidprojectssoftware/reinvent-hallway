# 0025. Keep what attendees' agents send of a session; abstracts only for verified attendees

Date: 2026-11-13. Status: accepted. Issue #74; amends ADR 0003 ("we keep no
abstracts"). Decisions 3 and 4's gate, and the note on corroboration, are
superseded by the correction at the end (issue #103): descriptions are public.

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
- **The rule trusted a sync.** An agent token could send sessions it made up
  and so verify its attendee without AWS. Closed by the note below (issue
  #83): a sync now verifies only through an abstract another attendee also
  reported.

**Rejected:** showing the abstract to every signed-in user (signing in to
Hallway proves nothing about AWS registration); showing it publicly (the Site
Terms reading above); keeping only the abstract the reader's own agent sent
(an attendee could read abstracts only of sessions already on their schedule,
which is the least useful case); a separate table for abstracts (the consensus
would need its own vote and its own batch statements for no gain over a column
no read selects).

## Note, 2026-11-13: verified means a corroborated abstract (issue #83)

Reviewing #80 found that decision 3 could be passed by a forged sync: session
ids and every field but the abstract are on Hallway for anyone to read, so an
agent token could send them back as "its" sessions and be verified. Decision
3 now reads:

**A reader is verified for an event once at least one abstract from their own
sync matches another, independent reporter's abstract for the same session.**
Their own sync means a report kept from it (a session on their own schedule,
as before); independent means another attendee. The texts are compared
trimmed and with each run of whitespace as one space (`normalizeAbstract`),
never fuzzily, since a near match is what a forger would aim for. The abstract
is the one field Hallway never shows anyone unverified, so a match proves the
sender read it where AWS shows it. The domain states the rule
(`isCorroborated`, `canReadAbstract`); the D1 repository answers it in SQL,
and `schedule-repository.test.ts` holds both to the same answers.

**Computed on read, in one query.** Each report stores `abstract_key`, the
SHA-256 of its normalized abstract (`abstractKey`), written in the sync's own
batch (migration 0013). `hasCorroboratedAbstract` walks the reader's reports
for the event (`session_reports_by_attendee`) and, for each, probes
`session_reports_by_abstract (event_id, session_id, abstract_key)` for another
attendee's same key: one statement for search or get, whatever the page size,
never one per session. Hashing keeps that index at 64 characters a report
rather than the whole text.

What it means:

- **The first honest reporter of a session is not verified by it.** Their
  abstracts unlock once a second attendee's agent reports one of the same
  sessions with the same text, with no further sync of theirs: the read sees
  the second report. This is the price, and it is the same one ADR 0016
  already pays (consensus protects a session only once someone else reports
  it). At re:Invent most attendees share at least one keynote or popular
  session with someone, so the wait is until the next such person syncs; an
  attendee whose every session nobody else has synced waits longest.
- **Two forgers colluding cannot be prevented**, nor one person with two
  accounts: two made-up abstracts that agree corroborate each other. What
  they unlock is other attendees' reports of abstracts, which AWS shows any
  registered attendee, and Hallway still never makes the text public. Nor is
  an abstract that is easy to guess (a placeholder AWS gives many sessions)
  proof of anything; a minimum length or a denylist is open if one appears.
- **A reporter whose abstract AWS later changes** stops being corroborated by
  that session when their agent syncs the new text, until another reporter
  sends the same new text; their other sessions still count. The attendees
  who still hold the old text keep corroborating each other. Verification is
  never stored, so nothing has to be revoked or recomputed.
- **Reports written before migration 0013 carry no key** and verify no one
  until their attendee's next sync writes one. Hallway is not deployed, so
  this touches only local databases.
- A forged sync still counts as a report for ADR 0016's consensus: a lone
  honest reporter and a forger tie, and the newer report wins. That is ADR
  0016's stated cost, unchanged here.

**Rejected:** corroborating on a field Hallway never shows (there is no such
field but the abstract); computing verification in the sync's batch and
storing it (the first reporter would need a second statement over every
earlier reporter of the session on each sync, and a stored verdict would need
revoking when an abstract changes, for no saving over one indexed read);
fuzzy matching (it narrows the gap a forger has to close); keeping the gate as
it was.

## Correction, 2026-11-13: descriptions are public (issue #103)

**The premise was wrong.** "The catalog is gated by design" holds for the
Events **API**, not for AWS's website. Measured 2026-11-13 by the
orchestrator in a real browser, signed out: AWS's public catalog page
(`https://registration.awsevents.com/flow/awsevents/reinvent2026/eventcatalog/page/eventcatalog`)
lists 2,588 sessions, each with its title, code, type, level, features and
**full description**. Opening it with `?search=<code>` puts that session
first (tried `ANT319-R1` and `SEC205`). Only the API needs a signed-in,
registered attendee. The owner, the same day: "This is available without
signing in so why can't we have the descriptions / information shown in the
public event catalog?"

**Decision, superseding decision 3, the gate in decision 4, and the note on
corroboration (#83):**

1. **A session's description is shown to everyone who can see the session**,
   signed in or not, like every other field. `canReadAbstract`,
   `isCorroborated`, `readsAbstracts` and the Session screen's reader states
   (#88, #96) are gone.
2. **Which text is shown is still the reporters' consensus (ADR 0016, and
   decision 5 above)**, so one forger cannot rewrite a description that two
   honest reporters agree on.
3. **Descriptions still come only from attendees' agents.** Hallway never
   fetches or scrapes the public catalog page or the service behind it: the
   Site Terms quoted above prohibit "data mining, robots, or similar data
   gathering and extraction tools". Every session keeps its link to AWS's
   page, which is how someone reads a session nobody has synced yet. The
   `sync_my_schedule` description tells agents Hallway accepts only the
   sessions on the user's own schedule, never a catalog dump; the sync
   already drops a snapshot for a session in none of its lists (#67).
4. **Only search and get carry it**, as before, now for size rather than
   secrecy: the largest field stays off schedules, agendas and sync results.
   Link previews, share images and the calendar feed stay title, time and
   venue, by design rather than as a secret. Held by the same construction
   (`catalogColumns`, the one `abstracts` read) and the same tests, which now
   assert that everyone reads the consensus description, that a lone forger
   cannot change one two honest reporters agree on, and that no description
   reaches OG tags, share images or the calendar feed.
5. **Credit.** Wherever a description shows, one plain line: "Session details
   from the AWS re:Invent catalog", linking to the session's AWS page. The
   Session screen shows it; search and get's tool and field descriptions ask
   agents to do the same.
6. **Off switch.** `SHOW_SESSION_DESCRIPTIONS` (a Worker var, `"1"` in
   `wrangler.jsonc`; `"0"` turns it off) hides descriptions from search and
   get, the only reads that carry them, so from REST, MCP and the web at once,
   if AWS ever asks. Stored descriptions are kept, so turning it back on needs
   no resync. `schedule.test.ts` proves off removes them for every reader.
7. **Session link.** `SESSION_URL_TEMPLATE` defaults to the measured search
   link above (closing #19); the old default's path
   (`event-catalog/page/eventCatalog`) was wrong.

**Migration 0013's abstract keys are dropped** (migration 0015, column and
index). Consensus never used them: it votes on the abstract's text, as on
every other field, in SQL and in the domain alike. Their one reader was
corroboration, which is gone, so keeping them would have been a write per
report and an index nobody reads. Hallway is not deployed, so this touches
only local databases.

**Rejected:** fetching descriptions from the public page ourselves (the Site
Terms); dropping consensus for the description now that it is public (a lone
agent could then rewrite what everyone reads); adding descriptions to the
link preview, share image or feed (they are about where someone will be, and
a description makes a post or calendar entry long without helping it).
