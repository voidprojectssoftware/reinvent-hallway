# Mobile design review (#107)

A designer's pass over every screen of Hallway on three phone profiles,
light and dark. No code was changed.

## Setup

- Commit: `origin/mvp` at d856948. `npm run dev` on port 24107, then
  `npm run seed:demo`.
- Extra state synced for Blake Hastings (`PUT /api/events/reinvent2026/my-schedule`
  with `Bearer dev:<id>`):
  - a crowded Tuesday 1 December, 12 sessions with chains of clashes;
  - one long title with a long room;
  - one untimed session (`s-tba100`) and one with no abstract (`s-meet1`);
  - one hidden session (`s-con201`, `PATCH ... {hidden:true}`).
- Network state:
  - Sofia Alvarez and "Alexandria Konstantinopoulou-Whitfield" request Blake;
  - Blake requests Dana Kim;
  - Eli Brooks is a LinkedIn suggestion (CSV upload);
  - Blake follows Sofia and Eli on GitHub (`/api/dev/github`).
- Other people: Dana Kim has an empty week, and "王芳" has a placeholder handle,
  so she gets the handle prompt.
- Driver: Playwright's library (the one inside the global `@playwright/cli`) on
  Chromium with the `iPhone 15` (393x852, DPR 3), `Pixel 7` (412x915, DPR 2.625)
  and `iPhone SE` (375x667, DPR 2) descriptors (viewport, DPR, touch, mobile UA),
  in light and dark, with reduced motion. I did not use the
  `voidprojects-websites:visual-check` scripts: they build and capture an Astro
  site, and this is a Vite SPA behind a Worker.
- Two consequences of using Chromium rather than WebKit:
  - the font is the Linux fallback, not SF, so lines run a little wider than on
    an iPhone;
  - `env(safe-area-inset-*)` is 0, so the safe-area findings come from reading
    the CSS.
- For each screen and device: the fold, the full page, and the bottom of the
  page with the tab bar over it. There is also a mechanical audit
  (`.review/shots/audit.json`) of sideways overflow, targets under 44 px
  without an `::after` extension, and clipped text.
- Files:
  - Screenshots: `.review/shots/<screen>-<device>-<scheme>-{fold,full,bottom}.png`
    (486 files).
  - Contact sheets of all six device and scheme pairs, side by side:
    `.review/sheets/<screen>-<kind>.png`.
  - Close crops: `.review/crop-*.png`.
  - Note: Playwright's full-page shots paint the fixed tab bar part way down
    the page. That comes from the capture, not from the app.

## Ranked findings

Ranked by how much each one hurts a person checking their phone in a
re:Invent hallway. "All" means all three devices in both schemes.

### 1. "Time to come" overprints the session title (All)
- **Screen:** My week, list and calendar views, in the "Time not announced yet" group.
- **Shot:** `week-list-tue-iphone15-light-bottom.png`, `week-cal-tue-iphone15-light-full.png` (bottom).
- **Wrong:** `.when` is 78 px wide with `white-space: nowrap`. "Time to come" in
  15 px semibold is about 100 px wide, so it paints over "Mystery session...".
  This is text on text: the worst kind of breakage.
- **Fix:** in an untimed row, drop the time column. Render the cell without
  `lead-time` and say nothing in the row, because the group heading already
  says "Time not announced yet". Also let `.when b` wrap
  (`white-space: normal`) so any future label that is too long breaks instead
  of colliding.
- **Where:** `apps/web/src/schedule/EntryCell.tsx` (`When`),
  `apps/web/src/styles/components.css` (`.when`).

### 2. Find a session scrolls sideways on iPhone SE (SE, light and dark)
- **Screen:** Sessions search (every state).
- **Shot:** `sessions-iphonese-light-fold.png` (Fri is cut off; `audit.json` reports overflowX 49 px).
- **Wrong:** the "Any day" chip plus five dates gives 6 chips. Each `.day` has
  `min-width: 52px` and the gap is 8 px: 6×52 + 5×8 = 352 px, but the column is
  343 px. The whole page pans sideways under a thumb. This is the only screen
  that overflows.
- **Fix:** add `min-width: 0` to `.day` inside a six-chip row (for example
  `.days:has(.day.any) .day { min-width: 0 }`) and drop the gap to 6 px, or set
  `.days { gap: clamp(4px, 1.5vw, 8px) }`. Keep the label from wrapping into
  two type styles ("Any / day"); "All" in the `b` style fits.
- **Where:** `apps/web/src/styles/components.css` (`.days`, `.day`),
  `apps/web/src/styles/app.css` (`.day.any b`), `apps/web/src/screens/Sessions.tsx`.

### 3. "Any day" results show times with no day (All)
- **Screen:** Sessions search, unfiltered or with a query.
- **Shot:** `sessions-iphone15-light-fold.png`, `sessions-q-iphone15-light-full.png`.
- **Wrong:** the list runs "7:30 PM Monday Night Live", then "All day Expo", then
  "8:30 AM Building agents...". Nothing says which day each time belongs to, so
  the reader cannot tell a Tuesday 8:30 from a Thursday 8:30.
- **Fix:** with "Any day", group the results under a sentence-case `.ghead` per
  day ("Tuesday 1 December"), as a person's page already does.
- **Where:** `apps/web/src/screens/Sessions.tsx`.

### 4. A short calendar block cuts its title through the middle of a line (All)
- **Screen:** My week, Calendar; a person's calendar.
- **Shot:** `.review/crop-cal-hidden-iphone15.png`.
- **Wrong:** in the 45-minute hidden block, "budget" is cut in half
  horizontally, and "Clash" and "Hidden from others" are packed under it. The
  container queries (90/52/30 px) budget for title, place and flag. A hidden
  block also carries "Hidden from others", so it overflows by a line.
- **Fix:** in a hidden block, the eye icon in `.cal-b-top` already says hidden.
  Drop the "Hidden from others" words below `@container (max-height: 90px)`, or
  count that line in the clamp (line-clamp 1 for a hidden block under 90 px).
- **Where:** `apps/web/src/styles/app.css` (the `.cal-b-*` container queries),
  `apps/web/src/schedule/WeekCalendar.tsx` (`Block`).

### 5. The fold on My week is mostly chrome (All; worst on SE)
- **Screen:** My week, list and calendar.
- **Shot:** `week-list-tue-iphone15-light-fold.png` (one and a half sessions), `week-list-tue-iphonese-light-fold.png` (about half a session).
- **Wrong:** five rows stack before the first session: the 34 px large title,
  the time-zone line, List/Calendar, the day chips, and a 20 px "Tuesday 1
  December / 12 sessions" heading. That is about 45% of an iPhone 15 and 60%
  of an SE. On SE the heading wraps to two lines and "12 sessions" wraps too.
  The heading repeats the chosen chip.
- **Fix:**
  - Move List/Calendar into the nav bar's right side as a compact two-icon
    control beside Share, or into the line under the title.
  - Fold the count into the chips' small line ("Tue · 12") and drop the
    `ghead big` day heading on phones.
  - Make `.days` sticky under the nav (`position: sticky; top: var(--nav-h)`
    on the bar background) so a person halfway down a crowded day can switch
    days without scrolling back up. See also finding 6.
- **Where:** `apps/web/src/screens/MyWeek.tsx`,
  `apps/web/src/schedule/WeekView.tsx`, `apps/web/src/schedule/DayChips.tsx`,
  `apps/web/src/schedule/WeekCalendar.tsx` (the same heading),
  `apps/web/src/styles/components.css` (`.days`).

### 6. The day chips scroll away (All)
- **Screen:** My week, a person's week, Sessions.
- **Wrong:** on a 12-session day the list is 7 to 8 screens long, and changing
  day means flicking back to the top. Between sessions, the question is "what
  is next today, and what is tomorrow".
- **Fix:** sticky chips, as in finding 5. Optionally add a "Now" jump during the
  event, since `useNow` already exists.
- **Where:** `apps/web/src/schedule/DayChips.tsx`, `apps/web/src/styles/components.css`.

### 7. The phone calendar runs to midnight on every day (All)
- **Screen:** My week, Calendar, one day.
- **Shot:** `week-cal-tue-iphone15-light-full.png` (7 PM to 11 PM are empty), `week-cal-wed-*`.
- **Wrong:** `hoursShown` is computed over every timed entry in the week
  (Wednesday's 11:30 PM session), so every single-day view on a phone gets
  five empty hours to scroll past.
- **Fix:** when `!sideBySide`, compute `hours` from the chosen day's spans only.
  Keep the whole-week range for the side-by-side grid.
- **Where:** `apps/web/src/schedule/WeekCalendar.tsx` (`const hours = hoursShown(...)`).

### 8. The share sheet is taller than the phone and hides its actions (All; SE worst)
- **Screen:** My week, then Share.
- **Shot:** `share-sheet-iphonese-light-fold.png` (only "Copy link" peeks in), `share-sheet-iphone15-light-fold.png`.
- **Wrong:**
  - Above the actions sit a three-line title paragraph, two thumbnails with
    two-line captions, a visibility explanation, a segmented control and a
    four-line footnote. A person who wants "Copy link" must scroll inside a
    sheet.
  - The sheet's top touches the screen edge (`max-height: 100dvh`), so the
    grabber sits on Safari's toolbar.
  - On SE, "Only me" runs to the edge of its segment.
- **Fix:**
  - Put the action rows (Copy link, Copy invite link, Post on LinkedIn) right
    under the title.
  - Collapse visibility to one row, "Who can see my week: My network ›",
    opening Settings or a second sheet.
  - Keep the pictures, but under the actions.
  - Cap the sheet at
    `max-height: calc(100dvh - var(--nav-h) - env(safe-area-inset-top))` so a
    strip of the page shows above it. iOS sheets never cover the whole screen.
- **Where:** `apps/web/src/share/ShareSheet.tsx`, `apps/web/src/styles/app.css` (`.sheet-in`, `.sheet-vis`).

### 9. On a session, who is going comes last (All)
- **Screen:** Session.
- **Shot:** `session-desc-iphone15-light-full.png`.
- **Wrong:** the order is title, When/Where/Speakers, About, Topics, AWS
  services, Open on re:Invent, On your week (Hide, Tell people), and then "Your
  network going". The one thing Hallway knows that re:Invent does not is about
  three screens down on an iPhone 15. The fold shows only the title and the
  details card.
- **Fix:** order it as title, When/Where, "Your network going", "On your week"
  (with Hide and Tell people), Open on re:Invent, then About, Topics and
  services.
- **Where:** `apps/web/src/screens/Session.tsx`.

### 10. The same person appears up to three times on Network, with conflicting actions (All)
- **Screen:** Network.
- **Shot:** `network-iphone15-light-full.png`.
- **Wrong:**
  - Eli Brooks shows under "From your LinkedIn connections", "Following on
    GitHub" and "Following from LinkedIn", each with its own Connect.
  - Sofia Alvarez has asked to connect (Accept/Decline under Requests), yet she
    also shows under "Following on GitHub" with "Connect".
  - On a phone, that is three screens of repeated rows.
- **Fix:** one row per person, in their strongest state (request > connection >
  suggestion > following), with the reasons as a subtitle ("On GitHub and in
  your LinkedIn file"). A person with a pending request shows Accept, never
  Connect.
- **Where:** `apps/web/src/screens/Network.tsx`, `apps/web/src/network/Following.tsx`.

### 11. On Network, only the 36 px avatar opens a person (All)
- **Screen:** Network: requests, suggestions, following.
- **Shot:** the `audit.json` "a. AK/SA/EB/DK 36x36" entries.
- **Wrong:** before accepting a request, a person wants to see who it is. Only
  the avatar is a link (36×36, under 44). The name beside it is plain text and
  does nothing when tapped.
- **Fix:** wrap the avatar and the name/subtitle in one link (the `cellmain`),
  leaving the pills outside it, so the target is the full row height.
- **Where:** `apps/web/src/screens/Network.tsx` (incoming requests, `PersonRow`),
  `apps/web/src/network/Following.tsx` (line ~126).

### 12. Segmented controls are 32 px tall (All)
- **Screens:** List/Calendar (My week, a person's page), Who can see my week
  (Settings, the share sheet, the composer), Claude Code/Kiro (Agent), and
  My week/A day/Sessions (composer).
- **Wrong:** `.seg button { height: 32px }`, under the 44 px rule in the
  design README. iOS draws 32, but these controls change who sees your week
  with one tap. On SE the visibility segments are 82 to 113 px wide and "Only
  me" touches its edge.
- **Fix:** give `.seg button` a 44 px target with the same `::after` trick as
  `.minibtn` (`inset: -6px 0`), or raise the control to 36 px and pad the
  wrapper. On narrow screens, drop the button's horizontal padding to 6 px.
- **Where:** `apps/web/src/styles/components.css` (`.seg`).

### 13. A long session title fills the SE fold (SE, then iPhone 15)
- **Screen:** Session.
- **Shot:** `.review/sheets/session-long-fold.png`.
- **Wrong:** `.large h1.long` is Title 1 (28 px bold). An 80-character title
  takes eight lines on SE, about 300 px, before When/Where.
- **Fix:** use Title 2 (22 px) for `long` on screens under 430 px. Clamp to four
  lines with a "more" tap, or let the full title live in the When/Where card.
- **Where:** `apps/web/src/styles/components.css` (`.large h1.long`),
  `apps/web/src/screens/Session.tsx` (when `long` is set).

### 14. "No one you know yet" on every row (All)
- **Screen:** My week, list.
- **Shot:** `week-list-tue-iphone15-light-full.png`.
- **Wrong:** on a crowded day it is the most repeated line on the screen. It
  adds about 30 px to each row and buries the rows where someone you know
  *is* going.
- **Fix:** show the going row only when there is someone. An absence is not
  news.
- **Where:** `apps/web/src/screens/MyWeek.tsx` (`cell`),
  `apps/web/src/schedule/going.ts` / `Going.tsx`.

### 15. The composer is ten screens long before the post (All)
- **Screen:** Tell people you're going (`/share/post`).
- **Shot:** `compose-iphone15-light-full.png`.
- **Wrong:** opened from a session, the picker lists all 26 of my sessions with
  rings before the picture and the text. The copy and LinkedIn actions are at
  the very end.
- **Fix:** opened with `?session=`, show only the chosen session with a
  "Choose sessions" row that expands the list (or limits it to that day). Put
  Copy text / Open LinkedIn in a sticky bottom bar above the tab bar.
- **Where:** `apps/web/src/screens/Compose.tsx`.

### 16. Little room above the home indicator at the foot of every screen (iPhones with a home indicator)
- **Screen:** every tabbed screen.
- **Wrong:** `main` pads its bottom with `calc(var(--tab-h) + 48px)` = 97 px,
  but the tab bar is `49px + env(safe-area-inset-bottom)` = 83 px on an
  iPhone 15. That leaves 14 px between the last group and the bar, against
  48 px of air on a phone without an inset. The design meant 48 px.
- **Fix:** `padding-bottom: calc(var(--tab-h) + env(safe-area-inset-bottom, 0px) + 32px)`.
- **Where:** `apps/web/src/styles/components.css` (`main`).

### 17. The Connected button removes the connection through a browser alert (All)
- **Screen:** a person's page, when connected.
- **Shot:** `person-visible-iphone15-light-full.png`.
- **Wrong:** the biggest button on the card is a removal. It confirms with
  `window.confirm`, a gray web alert that does not look like the rest of the app.
- **Fix:** open the existing `Sheet` as an action sheet ("Remove Priya from
  your connections?" with a red Remove and Cancel). Consider making the button
  a status pill with a "..." menu rather than a full-width button.
- **Where:** `apps/web/src/screens/Person.tsx` (line ~267), `apps/web/src/shell/Sheet.tsx`.

### 18. Network rows squeeze on SE (SE)
- **Screen:** Network: following and suggestions.
- **Shot:** `.review/sheets/network-bottom.png` (first two columns).
- **Wrong:** "Their week is for their network" wraps to three lines beside the
  Connect pill, and the name wraps too ("Sofia / Alvarez").
- **Fix:** put the pill under the text, as `.cell-actions` already does for
  requests, below about 380 px. Or shorten the subtitle to "Network only".
- **Where:** `apps/web/src/network/Following.tsx`, `apps/web/src/screens/Network.tsx`.

### 19. An empty 44 px bar on signed-out screens (All)
- **Screens:** sign-in, a person's page signed out or with an invite.
- **Shot:** `signin-iphone15-light-fold.png`, `person-invite-out-iphone15-light-full.png`.
- **Wrong:** a blurred, empty nav band with no title, no back and no brand. It
  reads as unfinished. On the invite page, the first thing a newcomer sees
  carries no "Hallway" anywhere.
- **Fix:** when there is no back and no action, show "Hallway" as the bar
  title on signed-out screens, or omit the bar.
- **Where:** `apps/web/src/shell/Screen.tsx`, `apps/web/src/screens/Person.tsx`, `apps/web/src/screens/SignIn.tsx`.

### 20. Empty week: two buttons of different widths (All)
- **Screen:** My week, empty.
- **Shot:** `week-empty-iphone15-dark-fold.png`.
- **Wrong:** "Connect your agent" and "Find a session" are each sized to their
  text and stacked centered, so they look misaligned.
- **Fix:** `.empty .btn { align-self: stretch }`, or a shared `min-width`, so
  both match.
- **Where:** `apps/web/src/styles/components.css` (`.empty .btn`), `apps/web/src/shell/Empty.tsx`.

### 21. Agent screen buries the last sync on a phone (All)
- **Screen:** Agent (`/connect`) for someone already synced.
- **Shot:** `connect-iphone15-light-full.png`.
- **Wrong:** the setup steps are for a computer, and come first. "Last sync: 23
  sessions, 2 minutes ago" is the only line useful on a phone, and it is at
  the bottom.
- **Fix:** when `lastSync` exists, lead with the Last sync group and collapse
  the three steps under a "Set up another agent" row.
- **Where:** `apps/web/src/screens/ConnectAgent.tsx`.

### 22. Minor
- **Clash lines.** On a crowded day nearly every row carries an orange "Same
  time as A and B", some on two lines. Fix: "Clashes with SVS330 +1". The
  session page can list them all. `apps/web/src/clash.ts` (`clashLabel`).
- **Nav titles truncate.** The scrolled nav title cuts long screen names ("Tell
  people you're go..."). Fix: set `navTitle` short ("Post", "Agent").
  `apps/web/src/screens/Compose.tsx`, `ConnectAgent.tsx`.
- **"Import again" target.** The link inside the footnote is 81×15 px. Fix: use
  `.linkbtn`'s `::after` extension for links in `.gfoot`.
  `apps/web/src/screens/Network.tsx`, `apps/web/src/styles/app.css`.
- **Search field height.** It is 36 px (the label is the target), which
  matches iOS. Leave it.
- **No top safe-area inset.** The `.nav` has none. Harmless in Safari. It would
  matter only if Hallway is ever added to the Home Screen as a standalone app;
  then add `padding-top: env(safe-area-inset-top)` to `.nav`.

## What already works on a phone

- **Tap targets.** Cells are full-row links of at least 44 px. Pill buttons
  extend to 44 px with `::after`, and `Why?` links do the same. Apart from
  finding 2, nothing overflows sideways on any device.
- **Inputs.** Every input is at least 16 px (17 px body), so iOS never zooms on
  focus. The profile handle and URL fields have the right
  `autoCapitalize`, `spellCheck` and `inputMode`.
- **Bottom sheets.** Done, Not now and Cancel sit at the bottom in a separate
  panel, within reach of a thumb. The handle prompt is a small, well-judged
  sheet. The Why sheet opens at the relevant section.
- **Calendar on a phone.** It shows one day, puts clashes side by side in
  lanes, says "Clash" briefly in narrow blocks, and moves overflow into a
  48 px "+N more" target.
- **Words, not color.** Reserved (green, with a check) and Interested (gray)
  are words. A hidden entry keeps full contrast and says "Hidden from others".
  Both schemes hold AA on what I looked at, and dark mode is consistent screen
  to screen.
- **Navigation.** The tab bar has a pending state and the screen dims while
  loading, so a tap shows at once that it was taken on bad hotel wifi. Back
  buttons name the screen they return to.
- **Copy.** Headers are in sentence case. Nothing from the owner's dislikes
  list appears: no uppercase eyebrows, icon-bullet strips, italic accent words
  or hero. The locked and invite states are clear and calm.
