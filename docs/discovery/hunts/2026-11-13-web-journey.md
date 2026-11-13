# Hunt: web journey (origin/mvp @ 30d17b7)

Dev server on HALLWAY_PORT=24611. People seeded by dev sign-in in the browser,
a token from "Connect your agent", and `sync_my_schedule` over `/mcp`.
Screenshots are under
`(screenshots kept outside the repo) `
(written `shots/` below).

## Findings

### F1 (bug) The share sheet's picture is not the picture that goes with the link

Steps: Alice keeps the default visibility (Connections), syncs 15 sessions,
opens My week, taps Share. The sheet shows a picture of her full week,
captioned (alt) "The picture of your week that goes with the link", above
"Post on LinkedIn".

What happens: "Post on LinkedIn" shares `/@alice-owner`, whose `og:image` is
the anonymous view (ADR 0012), which for a connections-only week is an empty
card: "Alice Owner's week is on Hallway, for the people they choose." The same
`imageUrl` fetched with her cookie is 86 KB (the full week), without it 33 KB
(the empty card). She sees one picture and posts another, and nothing in the
sheet says her visibility decides what LinkedIn shows.

Seen: `shots/20-share-sheet-390.png` (sheet) vs `shots/og-alice-anon.png`
(what LinkedIn fetches).

Where: `apps/web/src/share/ShareSheet.tsx` (preview `img` and its alt);
`/og/{handle}.png` renders "as the asker may see it" (domain.md ShareImage).
Either preview the anonymous card when Post on LinkedIn is the action, or say
"People who are not your connections see this card" with the visibility.

### F2 (bug) A failed action or load shows developer text and no next step

Steps: (a) On a session on my week, lose the connection (conference wifi) and
flip "Hide from others". (b) Open Network while the API answers 500 for one
of its reads.

What the person sees: (a) in red under the toggle, "Could not reach Hallway:
TypeError: Failed to fetch" (`shots/83-offline-action.png`). (b) "Could not
load this screen. GET /api/me/connections answered 500."
(`shots/84-500.png`). Neither says what to do; there is no Try again or
Reload button on the failed screen; the HTTP method, path and a JS exception
name are shown to an attendee. A whole-screen unreachable load is fine ("Check
your connection and reload."), so only the action path and the 5xx path are
off.

Where: `apps/web/src/api/client.ts` (lines 94 and 103 build the messages),
`apps/web/src/shell/Foot.tsx` `failureText` passes `Error.message` through,
`apps/web/src/routes.tsx` `LoadFailed` (no retry). Map `unreachable` and
`unexpected` to people words ("Hallway could not be reached. Check your
connection and try again." / "Hallway had a problem. Try again in a
moment.") and give LoadFailed a Try again that revalidates.

### F3 (rough edge) Slow network: a blank page on first load, and a tapped tab does nothing visible

Steps: delay every `/api` call by 3 s (a busy hotel network), open
`/network` cold, then tap "My week" in the tab bar.

What the person sees: a completely empty page for 6.6 s
(`shots/80-slow-first-load.png`: nothing, not even the tab bar or a title)
because the shell's loader and the screen's loader run one after the other.
Then tapping "My week" leaves the Network screen up, unchanged, with no
pending sign, for the length of the loaders (`shots/81-slow-tab-tap.png`);
people tap again. `routes.tsx` `Loading` returns null deliberately "for the
few milliseconds a local API takes"; at re:Invent it will not be milliseconds.

Where: `apps/web/src/routes.tsx` (`Loading`), `apps/web/src/shell/AppLayout.tsx`
(no `useNavigation().state` cue). Suggest the shell frame and title render at
once, and a quiet pending state (dim the outgoing screen or mark the tapped
tab) when navigation is loading.

### F4 (bug, accessibility) The share sheet does not hold focus, and Escape drops focus

Steps: keyboard only, at 1280 or 390. Tab to the Share button, Enter.

What happens: focus lands on Cancel (the last control). Tab from Cancel leaves
the `aria-modal` dialog and walks the page underneath (day chips, sessions,
tab bar) while the sheet still covers it; the sheet's own buttons are reached
only with Shift+Tab. Escape closes it and focus falls to `<body>`, not back
to the Share button (pressing Enter again does nothing). Screen reader users are told the dialog is modal and
then land outside it.

Where: `apps/web/src/share/ShareSheet.tsx` (no focus trap, `autoFocus` on
Cancel, no return of focus on close).

### F5 (bug) The tab title is wrong: someone else's name sticks, or it is just "Hallway"

Steps: (a) Open a friend's link `/@daniela-...` (the Worker puts her name in
`<title>`), then tap Network, then tap Ben in the list. (b) Open My week,
Network, Agent, Settings, Profile, any session from a fresh load.

What happens: (a) the browser tab, history entry and screen reader page title
stay "Daniela Alexandra Montgomery-Featherstonehaugh III at re:Invent 2026 ·
Hallway" on Network and on Ben's page; nothing ever resets it. (b) every other
screen is titled "Hallway", so history and tabs cannot tell a session from
Settings.

Where: the SPA never sets `document.title`; only the Worker's `/@handle` HTML
has one. `apps/web/src/shell/Screen.tsx` could set it from its `title` prop
("Graviton deep dive · Hallway", "Ben Okafor · Hallway").

### F6 (bug) A long name or headline on Profile answers with raw validation JSON

Steps: Settings, the profile cell, paste a 101+ character name (or a 201+
character headline: people paste their whole LinkedIn headline), Save.

What the person sees, in red under the form:
`[ { "origin": "string", "code": "too_big", "maximum": 100, "inclusive": true,
"path": [ "displayName" ], "message": "Too big: expected string to have <=100
characters" } ]`. Nothing says which field or how long it may be in words.
The inputs carry no `maxLength`, so nothing stops the paste. Handle errors,
by contrast, read well ("@ben-okafor is taken.", "A handle is 3 to 30 of
a-z...").

Where: `apps/web/src/screens/Profile.tsx` (inputs without `maxLength`; error
from `failureText`), and the API's `invalid` message for a zod failure is the
serialized issue list (`apps/api` request parsing). Either set `maxLength`
from the contract (100, 200) or map zod issues to a sentence ("A name is at
most 100 characters.").

### F7 (rough edge) "Last sync" on Connect your agent never notices the sync it asks for

Steps: a first-time person follows the screen literally: Make a token, copy
the command, ask the agent ("Put my re:Invent 2026 schedule on Hallway."),
then looks back at the same screen, whose last group is "Last sync".

What the person sees: "Nothing synced yet. Ask your agent once the steps above
are done." after the agent reported success (15 added). It stays that way
until a reload or leaving the screen (`shots/02-connect-issued-390.png`
shows the state; the sync had already landed when it was read). The screen
is the one place a person waits for the sync, and reloading it also throws
away the token they were shown once.

Where: `apps/web/src/screens/ConnectAgent.tsx` `SyncedSoFar` reads the loader
once. A revalidate on window focus or a light poll while no sync is recorded
would do.

### F8 (rough edge) An agent that synced 0 sessions looks exactly like never connecting

Steps: Eve connects her agent; it syncs, but she has no favorites on re:Invent
yet (or the agent read the wrong account), so the sync is 0/0/0.

What she sees: My week says "Nothing on your week yet. Ask your agent to put
your re:Invent favorites and reservations here" with a "Connect your agent"
button (`shots/60-eve-week.png`), the same as Finn who never connected
(`shots/60-finn-week.png`). She did exactly that. Connect your agent shows
"0 sessions, 2 minutes ago" but My week does not use `lastSync`. Nothing
suggests the real next step: favorite or reserve sessions on re:Invent, then
ask again.

Where: `apps/web/src/screens/MyWeek.tsx` empty branch; `schedule.lastSync` is
already loaded there.

### F9 (rough edge) The Claude Code command for Hallway is project-scoped while AWS's is user-scoped

Steps: Connect your agent, Claude Code. Step 1's command has
`--scope user awsevents`; step 2's Hallway command has no `--scope`.

What happens: `claude mcp add` defaults to the local scope (this project
directory only). Someone who runs both commands in their home folder and
later asks Claude in a project folder has the AWS server but not Hallway, and
"Put my re:Invent 2026 schedule on Hallway" fails there with no hint why.

Where: `apps/web/src/screens/ConnectAgent.tsx`, `agents.claude.hallwaySetup`.
Add `--scope user` to match step 1.

### F10 (bug) The back button on a session or a person names a fixed place, not where I came from

Steps and what happens:
- Signed out, a friend's public week `/@daniela-...` on a phone, tap a
  session. The header says "< My week" (`shots/141-signed-out-session.png`).
  A visitor has no week; tapping it goes to `/`, which bounces to the sign-in
  screen. The way back to the friend's week is gone (no tab bar either).
- Signed in, My week, tap AIM3315, tap Ben under "Your connections going".
  Ben's page says "< Network" and goes to Network, not back to the session.
- Ben's page, tap one of his sessions: "< My week", which goes to my week,
  not Ben's.

Every drill-down from someone's week (the core "see where my people will be"
journey) loses its place unless the person knows to use the browser's Back.

Where: `apps/web/src/screens/Session.tsx` (back is always My week),
`apps/web/src/screens/Person.tsx` (`back = me ? Network : undefined`). Use
the history entry when there is one in the app (or pass the origin in
navigation state), and for a signed-out visitor never point at `/`.

### F11 (rough edge) Signing in from a session forgets the session

Steps: signed out, open a session link a colleague sent
(`/sessions/s-arc402`), tap "Sign in to add it to your week", sign in.

What happens: lands on My week (`/`), empty for a first-timer
(`shots/130-after-signin-from-session.png`); the session they wanted to add is
gone and nothing leads back to it (there is no search). A person's page does
remember (`returnAfterSignIn`), so the mechanism exists. Same for a signed-out
person following a `/network` or `/settings` link.

Where: `apps/web/src/screens/Session.tsx` line 104 links straight to
`/sign-in`; `apps/web/src/shell/signed-in.ts` `requireSignIn` redirects without
a return path.

### F12 (rough edge) "Add a session from its page" points at pages a newcomer cannot reach

Steps: a first-time person with no agent yet (or no connections) opens My
week.

What they see: "Ask your agent to put your re:Invent favorites and
reservations here, or add a session from its page." (`shots/01-empty-week-390.png`).
The web app has no session search or list (the catalog search exists only
over MCP and `GET /api/events/{id}/sessions`), so the only way to reach a
session page is through someone else's visible week. For a newcomer the
second half of the sentence is a dead end.

Where: `apps/web/src/screens/MyWeek.tsx` empty state copy. Either drop the
clause until there is a search screen, or say "from a colleague's week".

Note on F2: an expired session on an action shows only "Sign in first." in red
under the button, with no link to sign in (`shots/150-expired-action.png`);
the next tab tap does go to sign-in.

## What held up

- Privacy, every path tried: a signed-out stranger and a signed-in
  non-connection looking at a private, a connections-only and a public
  person with one hidden session. Page text, every `/api` response in the
  network tab, the server HTML and its OG and Twitter tags, `/og/{handle}.png`
  (anonymous, and `?day=`), who-is-going, and session pages: nothing private
  or hidden showed. Hidden entries stay out of counts ("55 sessions"), the
  share card, the iCal feed and who-is-going even for connections. A private
  person connected by invite still shows nothing, and switching to private
  hides the week from existing connections at once.
- The invite token: removed from the address bar before render (history has
  no `?invite=` entry, Back never returns to it), not in the server HTML, OG
  tags or `og:url`, not in the dev server log, not sent in any API request but
  the connect call. Signed-out phone flow (open link, Sign in to connect, sign
  in, back on the person, one tap) works. A reset invite tells the next opener
  "This invite link no longer works: Alice has reset it. You can still ask to
  connect." and offers a request.
- Sync replaces (resync without one favorite: 1 removed, 14 unchanged), manual
  adds survive and say "Added on Hallway", agent entries cannot be removed
  and say why.
- Late evening and past-midnight sessions ("11:30 PM to 1:30 AM"), all-day
  sessions, 44 sessions on one day with clash labels, a 120-character title
  and a 50-character name all lay out at 390 and 1280, light and dark.
- Contrast: an automated pass over every text node on My week, session,
  person, Network, Connect, Settings, share sheet, sign-in and a signed-out
  person page, both schemes: nothing under AA.
- Focus rings are visible in both schemes on every control tried, icon buttons
  have names, the hidden file input shows focus on its label.
- Reload and deep links on `/sessions/x`, `/@handle`, `/@Handle` (case), a
  trailing slash, unknown session, unknown handle, `/@` and a random path all
  answer sensibly. Handle errors read well; a `javascript:` LinkedIn URL is
  refused.
- iCal feed: right timezone, all-day as DATE, the re:Invent link, 15 events.
