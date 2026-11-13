# AWS Events API and MCP server (measured 2026-11-13)

The spec as fetched is committed beside this file:
`aws-events-api/openapi-2026-11-13.json` (from `https://api.awsevents.com/v1/openapi.json`).
Build against that file, not against memory of it. Docs:
https://docs.aws.amazon.com/events/latest/devguide/mcp-server.html

## Facts

- REST base `https://api.awsevents.com`, paths under `/v1`. MCP at
  `https://api.awsevents.com/mcp`, streamable HTTP.
- `GET /v1/events` is public. On 2026-11-13 it returned one event:
  `eventId: "reinvent2026"`, "re:Invent 2026", Las Vegas,
  `2026-11-30T05:30-08:00` to `2026-12-04T23:59-08:00`,
  `timezone: "America/Los_Angeles"`, `authenticationRequired: true`.
- Sign-in: AWS Builder ID, OAuth authorization code with PKCE, one shared public
  client id (`7vmom55m1qstvq8i71ph127bfq`), scopes `openid email events/access`.
  Callbacks are loopback only, on fixed ports, matched exactly. **A hosted web
  app cannot use this client**, which is why Hallway's import path is the
  attendee's own agent (ADR 0003).
- Reading reInvent's catalog needs a token **and** registration for the event
  (403 otherwise). So Hallway cannot crawl it.
- Operations (REST and MCP tool names are the same): `ListEvents`, `GetEvent`,
  `ListSessions` (paged by `nextToken`, up to 250, `includeAbstracts=false`
  available), `GetSession`, `GetSchedule`, `ReserveSessions`,
  `CancelReservation`, `AssociateFavorites`, `DisassociateFavorite`,
  `Create/Update/DeletePersonalTime`.
- `Schedule` = `{ reserved: sessionId[], favorites: sessionId[], personalTime[],
  invitedSessions?: Session[] }`. Ids only, so an agent calls `GetSession` per id
  (or walks `ListSessions`) to get details.
- `Session` fields: `sessionId`, `title` (both required), `abbreviation` (code,
  e.g. "AIM3315"), `abstract`, `type`, `level`, `venue`, `room`,
  `isAllDaySession`, `isReservable`, `seatAvailability`, `sessionTime { date
  "2025-12-02", time "16:00", length "60", timezone? }`, `speakers[{name}]`,
  `tracks`, `topics`, `industries`, `areasOfInterest`, `roles`, `services`,
  `segments`, `features`, `customerPersonas`, `experiences`,
  `additionalActivities`, `focusAreas`. Every field but the two ids may be absent.
- **No session URL in the API.** The public site's deep-link format was not
  found (owner question).

## What Hallway takes from it

The `Session` shape, reduced (no abstract, ADR 0003), and the `Schedule` shape
as the input to `sync_my_schedule`.
