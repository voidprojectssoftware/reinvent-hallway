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

## Adding the server to an agent

An agent must name the shared client id and a fixed loopback callback port, or
Builder ID sign-in fails with a redirect mismatch (AWS's MCP server docs above).
The Connect screen (`apps/web/src/screens/ConnectAgent.tsx`) shows these:
Claude Code `claude mcp add --transport http --scope user awsevents https://api.awsevents.com/mcp --callback-port 8484 --client-id 7vmom55m1qstvq8i71ph127bfq`;
Kiro `mcp.json` `"awsevents": { "url": "https://api.awsevents.com/mcp", "oauth": { "clientId": "7vmom55m1qstvq8i71ph127bfq", "redirectUri": "http://127.0.0.1:8976", "oauthScopes": ["openid", "email", "events/access"] } }`
(`redirectUri` ends at the port; Kiro adds `/oauth/callback` itself).

## What Hallway takes from it

The `Session` shape, all of it but `seatAvailability` and `isReservable` (ADR
0025; the abstract only for verified attendees), and the `Schedule` shape as
the input to `sync_my_schedule`.

## Can a browser do the sign-in and the calls itself? (measured 2026-11-13)

The owner asked whether a client-side-only Hallway could sign attendees in to AWS and call the Events API from the browser. **No**, for two independent reasons:

1. **The redirect.** AWS only redirects to `http://localhost:8484` to `8489` `/callback`, matched exactly. A page served from Hallway's origin cannot receive it. A popup that lands on `localhost` is cross-origin, so its address cannot be read.
2. **CORS on the API (decisive).** Measured with curl:
   - `OPTIONS https://oauth.awsevents.com/oauth2/token` with any `Origin` returns 200 and echoes the origin. The token exchange alone would work in a browser.
   - `OPTIONS https://api.awsevents.com/v1/events/reinvent2026/schedule` with `Access-Control-Request-Method: GET` and `Access-Control-Request-Headers: authorization` returns **403**, for `https://hallway.example` and for `http://localhost:8484` alike.
   - Browsers always send that preflight before a request carrying `Authorization`, so no web page can read a signed-in response.
   - Unsigned requests (`GET /v1/events`) return `access-control-allow-origin: *`.

Signed-in use of the API is therefore limited to programs outside a browser: a CLI, a desktop app, or an agent through the MCP server. Relaying through Hallway's server would mean holding the attendee's token, which ADR 0003 rules out.
