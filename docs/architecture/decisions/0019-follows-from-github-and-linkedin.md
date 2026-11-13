# 0019. Follows from GitHub and LinkedIn, and who they let see what

Date: 2026-11-13. Status: accepted, built (#63; see the note at the end).

The owner, 2026-11-13: "We will want to be able to show them the schedule of
people they follow on linkedin / in their network and the same for github."

## What the providers allow

- **GitHub** publishes who a user follows: `GET /users/{login}/following`
  (paged, 100 a page), or `GET /user/following` with the user's own token. The
  ids are stable numbers.
- **LinkedIn** does not: its API gives neither follows nor connections to apps
  outside its partner programs (`docs/discovery/linkedin.md`). The member's own
  data export (`Connections.csv`) is the only route, and Hallway already reads it
  (ADR 0004).

## Decision

- **A Follow is one-way**: `follower` (an attendee), `followee` (an attendee, or
  a not-yet-joined GitHub user id), `source` (`github` | `linkedin-import`),
  `since`. When someone joins Hallway and links GitHub, follows that pointed at
  their GitHub id start pointing at them. A Hallway connection (mutual, ADR 0004)
  stays its own thing.
- **GitHub follows** are read with the user's token at sign-in or link time and
  on "Refresh from GitHub" (a fresh OAuth round trip). Hallway stores the
  followed ids, never the GitHub token. Same principle as ADR 0003: we hold no
  credential to anyone's other accounts.
- **LinkedIn follows** are the import: a contact that matches an attendee by the
  two-fact rule (ADR 0004) becomes a follow, not just a suggestion. Re-importing
  replaces the `linkedin-import` follows.
- **The visibility rule, extended.** "Connections" visibility becomes **"My
  network"**: an attendee's schedule is visible to
  1. themselves;
  2. their Hallway connections;
  3. **people they follow** (on GitHub, or found in their own LinkedIn import).

  Following someone never lets *you* see *their* schedule. Their following you
  does. The owner's own act (following, importing) is their consent; someone
  else's act is not. Public and private are unchanged; hidden entries are still
  never shown to anyone else.
- **What a person sees of the people they follow:** a "Following" list, grouped
  by source, showing each person's week where that person's visibility lets them
  see it (public, or they follow the viewer back, or connected). Otherwise the
  person is listed with "Their week is for their network" and a Connect action.
  Who-is-going, the network agenda and meeting gaps count everyone the viewer may
  see: connections and followed people alike.
- **MCP:** `list_my_connections` becomes `list_my_network` (connections and
  follows, each labelled with how), and the planning tools cover both. The tool
  descriptions say plainly that a followed person's week appears only if they
  share it.

## Owner question

The visibility rule above is a privacy promise, so it is the owner's to confirm
(#64). It is built as written meanwhile, because it is the stricter reading.

## Note, 2026-11-13: as built (#63)

Built as written. Where the ADR left a choice open, #63 took these; none
changes a decision above.

- **The rule takes a tie, not a boolean.** `canViewSchedule(viewer, owner,
  tie)` with `tie = { connected, followedByOwner }`. Whether the viewer follows
  the owner is not a field, so no caller can pass it by mistake. Every read
  path gets the tie from one lookup, `tieBetween` (the network repository's
  `tie`), which replaced `areConnected` in the composition root; the bulk
  reads (`networkPlans`, `networkOf`) read the same tie from the same tables
  in one statement beside their rows.
- **A GitHub follow names the GitHub account, not an attendee.** The `follows`
  table has `github_id` for GitHub follows and `followee_id` for import
  follows (a CHECK keeps exactly one set, by source). A GitHub follow reaches
  whoever has linked that account, by joining `identities` when it is read, so
  "follows that pointed at their GitHub id start pointing at them" needs no
  write when someone links GitHub, and stops when they unlink it.
- **Unlinking GitHub forgets my GitHub follows**, since they came from that
  account and they show my week to people.
- **"Refresh from GitHub" is a link round trip.** `POST
  /api/me/following/github/refresh` starts `/api/auth/github?link=1` for the
  person signed in and returns GitHub's URL (a fetch cannot follow a redirect
  to another origin); the callback stores the list. Without GitHub linked it
  links it, so the web offers it as "Add GitHub" then.
- **Replacing keeps `since`.** A refresh or an import deletes the follows of
  that source not in the new list and inserts the new ones, keeping existing
  rows: two statements in one batch, the ids as one `json_each` array
  (ADR 0011). 4,000 follows, the adapter's cap, is one batch of two.
- **An import writes follows in a second step**, after the contacts batch, from
  the stored contacts through the domain's `suggestions` (only the importer
  left out: connected or asked, a match is still followed). If that step fails
  the call fails and importing again repairs it. A person who joins after my
  import is suggested, and becomes a follow at my next import.
- **"My network" is connections plus the people I follow who are on
  Hallway.** Who is going, the agenda, session search's `connectionsGoing`,
  gaps and the counts read that set and filter each person through the rule. A
  person who follows me but whom I do not follow can show me their week (their
  page, get_person_schedule, find_meeting_gaps), but is not in my network and
  is not counted in who is going. The ADR's "everyone the viewer may see:
  connections and followed people alike" names that set.
- **`connectionsGoing` keeps its name** on sessions, and `GET
  /api/me/connections` and `ListConnections` stay as they were; the field now
  counts everyone in my network who lets me see their entry. Renaming it would
  break the web and agents for no gain in what it says.
- **`list_my_connections` answers as `list_my_network`** (same input, the new
  `NetworkList` output) for one release; its description says to use the new
  name.
- **The migration rebuilds `attendees`** to change the column default to
  `network`. D1 ignores drizzle-kit's `PRAGMA foreign_keys=OFF`, so the
  generated migration failed on any database with connections; it uses
  `PRAGMA defer_foreign_keys = on` instead (checked at commit, when the table
  is back under its name), and runs `UPDATE ... 'connections' -> 'network'`
  first. `network-repository.test.ts` applies it over rows that point at
  attendees.
- **Dev only: `POST /api/dev/github`** links a GitHub account with its
  following list to the person signed in, through the same link path a GitHub
  callback takes. It has dev sign-in's two holds (`DEV_SIGN_IN=1`, a loopback
  host). The e2e suite and a dev server use it, since neither can reach GitHub.
