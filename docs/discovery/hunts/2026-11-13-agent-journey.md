# Hunt: Hallway as an attendee's agent (origin/mvp 7d55227)

Server: `npm run dev` on 127.0.0.1:24617. Attendees Alice, Bob, Carol, Dave via dev sign-in, each with an agent token; all calls below over `/mcp` JSON-RPC with `Bearer hw_...` unless marked REST.

## Findings

### F1. bug: search_sessions never finds a name or title by a non-ASCII capital letter, even typed exactly

Sync a session with speakers `["Zoë Ångström", "李小龙"]` (Alice's agent). Then as Bob's agent:

```
search_sessions {"eventId":"reinvent2026","q":"Ångström"}      -> {"sessions":[]}
search_sessions {"eventId":"reinvent2026","q":"Zoë Ångström"}  -> {"sessions":[]}
search_sessions {"eventId":"reinvent2026","q":"ångström"}      -> {"sessions":[]}
search_sessions {"eventId":"reinvent2026","q":"ZOË"}           -> S-NORMAL (matches)
search_sessions {"eventId":"reinvent2026","q":"李小龙"}         -> S-NORMAL (matches)
```

What the user gets: "find the session Ångström is giving" or "Émilie Durand", "Łukasz", "Özil", "Šimon": nothing, with the exact spelling. The agent concludes the session is not in Hallway. Same for titles starting with such a letter.

Where: `packages/infrastructure/src/schedule/d1-schedule-repository.ts` `searchSessions`: the needle is `filter.q.toLowerCase()` (full Unicode, `Å` -> `å`) but the column side is SQLite `lower()` (ASCII only, `Å` stays `Å`), so they never meet. The in-memory fake (`in-memory-schedule-repository.ts`) lowercases both sides ASCII-only, so unit tests on the fake cannot see it. Fix direction: lowercase the needle the same ASCII-only way, or better, store a normalized (NFKD, accents stripped, casefolded) search column. "zoe" not finding "Zoë" is the accent-insensitive half of the same thing (domain.md only promises case).

### F2. rough edge: a session whose time AWS gives in an unexpected format is silently stored with no time, and the sync reports success

```
sync_my_schedule {... {"sessionId":"S-12H","title":"Twelve hour time","abbreviation":"TWLV","sessionTime":{"date":"2026-12-02","time":"4:00 PM","length":"60"}} ...}
-> {"added":14,...,"missingSessions":["S-BOTH","S-NEVERSEEN"]}
get_my_schedule -> S-12H has no startsAt/endsAt at all
```

The spec example is `"16:00"`, so this is not AWS's documented shape, but `sessionTime.time` is a free string and models do reformat. Nothing in the sync result says a session could not be placed, so the agent tells the user "done" and the session is invisible to gaps, agenda and day search. Same silence for an unparseable `date` (e.g. `"2026-12-1"`) and for `sessionTime.timezone` other than the event's (`"UTC"`, `"America/New_York"` are ignored and read as Las Vegas; that one is deliberate per the `toSession` comment).
Where: `packages/domain/src/sessions.ts` `placeInTime` returns `{}`; `SyncSchedule` result has no `unplacedSessions`-style count. Suggest returning the ids it could not place.

### F3. rough edge: a session with no `length` (or a timeless one) never blocks find_meeting_gaps

Alice's synced 2026-12-01 has `S-NOLEN` at 11:00 with `sessionTime.length` absent (spec allows it). Bob's agent:

```
find_meeting_gaps {"eventId":"reinvent2026","handle":"alice-example","day":"2026-12-01"}
-> gaps ... {"start":"10:00","end":"16:00"} ...
```

Hallway proposes meeting Alice at 11:00, the moment her session starts. `gaps.ts` documents "a session with no start or no end cannot be placed and does not block", but the tool description does not say so, so the agent presents the gap as certain. Assuming a default length (60) for a start without an end, or at least flagging such sessions in the result, would avoid double booking. Where: `packages/domain/src/gaps.ts` `findGaps`.

### F4. bug: a sync racing another write is not a "replace": it can leave the union of two syncs, or fail with a raw SQLite error

Sync is read-diff-write (`SyncSchedule` reads the current entries, computes add/remove/update, then `applySync` sends one batch of deletes by id and plain inserts). Nothing re-checks between the read and the batch.

Repro A (two agents for one attendee, e.g. Claude Code and Kiro, or one model firing the tool twice in parallel). Dave has one entry `ZZ1`. Dave's token syncs 120 `CA*` favorites while Dave's second token syncs 120 different `CB*` favorites, at the same moment. 20 trials:

```
19 x final get_my_schedule entries = 120   (one of the two syncs won)
 1 x final get_my_schedule entries = 240   (CA and CB together: a schedule neither agent sent)
```

Both responses that time were `{"added":120,"removed":1,...}`; `lastSync` showed one of them. The next sync from either agent repairs it.

Repro B (agent sync while the person, or the other agent, adds the same session by hand). Dave empty; concurrently `sync_my_schedule` with the 120 `CA*` and `add_to_plan {"eventId":"reinvent2026","sessionId":"CA0005"}`. 30 trials, one failed:

```
HTTP 200 isError: true
D1_ERROR: UNIQUE constraint failed: plan_entries.attendee_id, plan_entries.event_id, plan_entries.session_id: SQLITE_CONSTRAINT (extended: SQLITE_CONSTRAINT_PRIMARYKEY)
```

The whole sync rolled back (atomic, good) but the agent gets a raw SQLite message that says nothing about retrying, and the internal table and column names leak to the client. A model will likely report "Hallway is broken" rather than call again.

Where: `packages/infrastructure/src/schedule/d1-schedule-repository.ts` `applySync`: the plan-entry insert has no `onConflictDoUpdate`/`DoNothing` (compare `addEntry`, which has `onConflictDoNothing`), and removes are an id list from the earlier read rather than "every agent-sync entry not in this sync". Also wherever unknown errors are mapped to tool results (the MCP tool wrapper in `apps/api`): an unexpected error should become a generic "try again" message, not the driver text. Expected low frequency, but the failure mode is confusing.

### F5. bug: hiding a session does not survive the session leaving and returning in a later sync

Alice hides `S-NORMAL` on the web (REST, cookie: `PATCH /api/events/reinvent2026/my-schedule/entries/S-NORMAL {"hidden":true}`). Her agent syncs once without `S-NORMAL` in `favorites`/`reserved` (an unfavorite then refavorite on AWS, or just one sync built from a partial `GetSchedule` read, which models do produce), then syncs the full list again:

```
sync_my_schedule (without S-NORMAL) -> {"added":0,"removed":1,...}
sync_my_schedule (with S-NORMAL)    -> {"added":1,...}
get_my_schedule -> "sessionId":"S-NORMAL","intent":"reserved","source":"agent-sync","hidden":false
```

The session the user deliberately hid is now visible to all their connections (and the public, if public), with nothing telling the user. domain.md says every entry's `hidden` flag survives a sync; that holds only while the entry exists. Since the reason to hide is usually "I don't want people to see I'm going to X", this is a privacy surprise. Where: the sync handler in `packages/application` (the entry row and its `hidden` flag are deleted on remove); fix direction is to remember hidden session ids per attendee apart from the entry, or soft-remove agent-sync entries.

### F6. bug: any attendee's agent can rewrite any session in the shared catalog, including sessions not on their own schedule

Carol's agent syncs a snapshot of `S-NORMAL` (a session on Alice's schedule, not on Carol's; Carol's `favorites` is only `["X1"]`):

```
sync_my_schedule {"eventId":"reinvent2026","sessions":[{"sessionId":"S-NORMAL","title":"CANCELLED, see you at the bar","abbreviation":"AIM301","sessionTime":{"date":"2026-12-04","time":"06:00","length":"5"}}],"favorites":["X1"],"reserved":[]}
-> {"added":0,"removed":0,"changed":0,"unchanged":1,"sessionsStored":1,"missingSessions":[]}

Alice: get_my_schedule -> S-NORMAL "title":"CANCELLED, see you at the bar","startsAt":"2026-12-04T14:00:00.000Z" ...
```

Every attendee who planned that session now sees the new title and time, on the web, over MCP, in their subscribed calendar feed, and in gap finding. It needs no malice: a model that hallucinates or mis-copies one session's time corrupts it for everyone until the next honest sync of it. ADR 0009 accepts last-writer-wins between honest snapshots, but nothing limits who can write which session. Smallest fix: store only snapshots whose id is in that sync's `favorites`/`reserved` (today unlisted snapshots are stored too, see `sessionsStored:1`). Beyond that, the catalog trust model wants an owner decision (e.g. prefer the majority or the most recent of several attendees, or never let a later snapshot move a time by days). Where: the `SyncSchedule` handler in `packages/application` and `mergeSnapshot` in `packages/domain/src/sessions.ts`.

### F7. bug: a manual entry raised to `reserved` stays `reserved` after the reservation is cancelled on AWS

Carol adds `S-NORMAL` by hand, reserves it on AWS, syncs (raised to reserved, as domain.md says), cancels the reservation on AWS, syncs again:

```
add_to_plan {"eventId":"reinvent2026","sessionId":"S-NORMAL"}
sync_my_schedule {"eventId":"reinvent2026","sessions":[],"favorites":["X1"],"reserved":["S-NORMAL"]} -> {"changed":2,...}
sync_my_schedule {"eventId":"reinvent2026","sessions":[],"favorites":["X1"],"reserved":[]}           -> {"changed":0,"unchanged":1,...}
get_my_schedule -> "sessionId":"S-NORMAL","intent":"reserved","source":"manual"
```

Hallway keeps telling Carol's connections (and her calendar feed, which marks it CONFIRMED vs TENTATIVE) that she has a seat she no longer holds, forever, because "a sync never lowers a manual entry". This follows the written rule, so it is a rule gap rather than a code slip: the raise should be remembered as AWS's, so the sync that stops saying reserved can lower it back to `interested`. Where: domain.md "Sync replaces, never duplicates" and the sync planning in `packages/domain` / `packages/application`.

### F8. bug: invited sessions from AWS `GetSchedule` are never imported

AWS `Schedule.invitedSessions` holds whole sessions "the event placed on the attendee's schedule by invitation" (keynote seating, executive sessions). `sync_my_schedule` has no field for them and its description tells the agent to send only `favorites` and `reserved`. An agent that passes them anyway is silently ignored:

```
sync_my_schedule {"eventId":"reinvent2026","sessions":[{"sessionId":"INV1",...}],"favorites":[],"reserved":[],"invitedSessions":[{"sessionId":"INV1","title":"Invited keynote"}],"personalTime":[]}
-> {"added":0,"removed":3,...,"sessionsStored":1}
```

The invited session is stored in the catalog but not on Carol's schedule, so her week on Hallway is missing what may be her most important slots. Where: the input contract in `packages/contracts/src/schedule.ts` and the tool description in `apps/api` (MCP `sync_my_schedule`). Either accept `invitedSessions` (as reserved) or say in the description to add their ids to `reserved`.

### F9. rough edge: find_meeting_gaps and network_agenda happily answer for days outside the event, including last year

```
find_meeting_gaps {"eventId":"reinvent2026","handle":"alice-example","day":"2025-12-02"}
-> {"day":"2025-12-02",...,"gaps":[{"start":"08:00","end":"18:00"}]}
network_agenda {"eventId":"reinvent2026","day":"2026-12-31"} -> {"items":[]}
```

Models default to the year in their training data, and AWS's own spec example is `"2025-12-02"`. The agent then tells the user "you and Alice are both free all day Tuesday". A day outside the event's `startDate`..`endDate` (or at least outside its year) should be `invalid` with the event's dates in the message. Where: the gap and agenda handlers in `packages/application/src/network/`.

### F10. rough edge: error messages that send the agent somewhere it cannot go

- `remove_from_plan` on a synced entry: `{"kind":"conflict","message":"Session X1 came from your AWS schedule, so the next sync would bring it back. Hide it here, or remove it from your AWS favorites or reservations and sync again."}`. There is no MCP tool to hide; "here" means the web app. Say "the user can hide it on their Hallway schedule page".
- `add_to_plan {"sessionId":"AIM301"}` (the code users read out): `{"kind":"not-found","message":"No session AIM301 in reinvent2026's catalog. An agent has to sync it first."}`, while the session is in the catalog under id `S-NORMAL`. Suggest `search_sessions` with the code; or accept a code when it is unambiguous.
- `get_person_schedule` for a connection whose schedule is private: `"...is not visible to you: it is private, or for their connections only."`, and the tool description says "suggest the user connect with them on Hallway". Bob is already connected to Alice (`list_my_connections` lists her), so the agent tells him to connect with someone he is connected to. Say "private" when that is the reason (the card already knows `visibility`), and/or carry `scheduleVisible` in `list_my_connections`.
- Unauthenticated MCP call: `{"kind":"unauthenticated","message":"Sign in to have a schedule."}`. An agent cannot sign in; say "send an agent token from Hallway's Connect page as `Authorization: Bearer hw_...`".

### F11. rough edge: one non-string field fails the whole sync

```
"sessionTime":{"length":60}        -> MCP error -32602 ... expected string, received number at sessions[0].sessionTime.length
"venue":null / "abstract":null    -> ... expected string, received null at sessions[0].venue
```

AWS's spec types these as strings and never documents null, so this is defensive, but models re-serialize ("60" -> 60) and JSON from other MCP bridges often carries nulls. One bad field rejects a 200-session sync. The messages are clear enough for a model to repair, so low priority. Coercing number to string and null to absent at the contract would remove the failure entirely. Where: `packages/contracts/src/schedule.ts`.

### F12. rough edge: search_sessions caps at 200 with no sign of truncation

With 1,300 sessions on 2026-12-04, `search_sessions {"day":"2026-12-04","limit":200}` returns 200 sessions and no total, cursor or `truncated` flag. The agent cannot tell it saw a fraction, and cannot page. Add `nextCursor` or at least `total`. Where: search handler and `SearchSessions` contract.

### F13. rough edge: small inconsistencies a model trips on

- `network_agenda` accepts `to:"24:00"`; `find_meeting_gaps` rejects it (`must match pattern /^([01]\d|2[0-3]):[0-5]\d$/ at to`), so "find a gap this evening" must use `23:59`.
- A revoked or unknown token gets `401` with no `WWW-Authenticate` header, and `/.well-known/oauth-protected-resource` and `/.well-known/oauth-authorization-server` answer `200 text/html` (the SPA fallback). MCP clients that start OAuth discovery on 401 (Claude Code does) will parse HTML as metadata and show a confusing error instead of "token revoked". These paths should 404.
- `who_is_going` returns `{"sessionId":"NOPE","people":[]}` for an id Hallway has never seen, indistinguishable from "nobody you know is going".

## What held up

- Times: 16:00 local on 2026-12-01 -> `2026-12-02T00:00Z` (PST, -08:00); a 2026-11-28 session also PST; a 23:30 session crossing midnight gets the right UTC day; gaps and agenda clip by Las Vegas day; the iCalendar feed uses `TZID=America/Los_Angeles` with a correct VTIMEZONE, CRLF, folded at 75 octets without splitting UTF-8, and all-day as `VALUE=DATE` + TRANSPARENT. No PDT/PST slip found.
- Messy AWS data: no `sessionTime`, no `abbreviation` (no url, no crash), `length` "0" and absent, all-day with and without time, `"16:00:00"`, speakers `[{}]`, non-ASCII names stored and served intact, a pre-event date, duplicate id within one sync (last wins), an id in both lists (reserved wins), ids without snapshots (reported in `missingSessions`, once each).
- Abstracts: sent on every session in 300- and 240-session syncs; never seen in any response.
- Scale: 300 sessions with abstracts (0.8 MB) and 1,000 sessions in one call both succeed in about 0.2 s locally.
- Idempotence: the same sync twice gives `unchanged` only; reserved -> favorite gives `changed:1`; `hidden` survives syncs while the entry stays.
- Visibility: connections / private / public each behave as domain.md says across get_person_schedule, find_meeting_gaps, who_is_going, network_agenda and search `connectionsGoing`; hidden entries are left out for others and in the feed.
- Tokens: a revoked token is refused at once (`401 "The agent token is unknown or revoked."`); an agent token cannot read the invite (`403`); an old invite after rotation is refused, the new one connects, connecting to yourself is refused.
- Argument guessing: `@handle` and mixed case handles are accepted; missing `eventId`, `day:"Tuesday"`, `from:"1pm"`, `from:"13:00:00"`, reversed windows, `2026-02-30` all get errors a model can act on; `%` and `_` in search are literal.
- The MCP SDK client (1.32.2) connects, lists 12 tools with output schemas, and gets structured results and error results.
