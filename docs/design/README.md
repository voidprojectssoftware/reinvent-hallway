# Hallway design

Static mock screens, tokens and components for the web app (issue #10), drawn
before the app exists so the owner can react early and the web builders port a
settled look. ADR 0005 chose the look: the Halloween weekend map's iOS layer.

Open `index.html` through any static server (the icons are an external SVG
sprite, which `file://` will not load), for example
`npx --yes http-server docs/design -p <free port>`. `?theme=dark` or
`?theme=light` on any screen forces a scheme; the toggle on the index page
remembers one. `screens/` holds every screen at 390 and 1280 px wide, light and
dark, and the share card at 1200 by 627.

All names, sessions and companies are made up. `hallway.example` stands for
the host, which is not decided.

## Files

| File | What it is |
| --- | --- |
| `tokens.css` | Colors (light and dark), type, spacing, radii, shadows, sizes |
| `components.css` | Every component, built only from the tokens |
| `icons.svg` | The line glyphs, as a sprite (`icons.svg#i-week`) |
| `theme.js` | The light and dark toggle. The only script |
| `components.html` | Each component alone |
| `my-week.html`, `my-week-share.html` | My week; the share sheet over it |
| `person.html`, `person-private.html` | `/@handle`, visible; the "not visible to you" state |
| `session.html` | One session |
| `network.html` | Requests, LinkedIn suggestions, connections |
| `connect-agent.html` | The three steps and the last sync |
| `settings.html` | Visibility, calendar feed, tokens, LinkedIn import (not asked for; the tab bar needed it) |
| `share-card.html` | The LinkedIn picture, 1200 by 627 |

## Decisions

**Accent: indigo.** `#5856d6` (Apple's systemIndigo) in light, `#9896ff` in
dark. iOS blue was the obvious choice and was rejected on two counts: `#007aff`
is 4.0:1 on white, under AA for link text, and every darkened blue reads as
LinkedIn's, which sits next to Hallway in every post. AWS's orange and squid
ink belong to AWS, and Hallway must not look like an AWS product. Halloween's
pumpkin belongs to Halloween. Indigo is still a system color, so the app looks
native. Apple's dark indigo (`#5e5ce6`) is 3.4:1 on a dark cell, so the dark
tint is lighter, and text on it is the cell color (Halloween did the same with
its dark orange).

**Type: the system font, nothing loaded.** The same stack Halloween used, at
Apple's text style sizes (`--t-large` 34 bold through `--t-caption` 12), with
tabular figures for times and session codes. No web font: an iOS-style app
in a font that is not the system's stops looking like one.

**Contrast: AA everywhere, so three of Apple's values changed.** Measured on
the rendered pages, both schemes, every text node:

- `--label2` (secondary text) is `rgba(60, 60, 67, 0.78)` in light, not
  Apple's 0.6, which is 3.3:1 on the grouped background.
- Green (reserved) is `#1e7a35` in light, not `#248a3d`, which is 3.9:1 on its
  own tinted badge.
- The red count badge on the Network tab is `#d70015` in both schemes; white on
  the dark scheme's `#ff453a` is 3.4:1.
- A gray button (`.btn.gray`, `.minibtn`) goes on a cell, never on the gray
  page, where the light tint on the fill is 4.42:1.

**Times are Las Vegas time, said once.** Under the large title on My week, in
the line above the first day on a person's week, in the "When" label on a
session, in the footer of the share card. Never per row.

**Wide screens get a sidebar.** From 1000 px the tab bar becomes a 240 px
sidebar, as iPadOS turns a tab bar into one; the content stays in a 720 px
column, as Halloween's did.

**Badges are words.** Reserved (green, with a check) is a seat held on
re:Invent; Interested (gray) is an AWS favorite. Never color alone.

## Kept from Halloween

The color tokens for both schemes (with the contrast changes above), the
system font, the 44 px navigation bar over a blur, the 34 px large title, inset
grouped lists with 12 px corners and separators inset to the text, footnote
group headers and footers, the five day chips sharing the row's width, the
segmented control, the 50 px buttons, the small pill buttons in cells, the
icon tiles on detail rows, the action sheet (grabber, grouped panel, separate
Cancel), the empty state inside a grouped cell, the search field, and the
`data-theme` override written twice (media query and attribute).

## Dropped from Halloween

- **Uppercase, letter-spaced labels** (`.ghead`, `.rowlabel`, the day chips'
  weekday). The owner dislikes uppercase eyebrows, and iOS 15 dropped them from
  inset grouped headers too. Headers here are sentence case.
- **The equal four-up action row** on the detail screen (`.act`: Calendar,
  Directions, Tickets, Source). It is close to the three-up strip the owner
  rejects. A session has one main action, "Open on re:Invent", as one button.
- **Fading a row to 0.5 opacity** to mark it (Halloween's "not interested").
  It put text under 4.5:1. A hidden entry here keeps full contrast, drops its
  title to the secondary label, and says "Hidden from others".
- **The Halloween layer**: pumpkin tint, map colors, kid and adult pills, the
  map, photos, the menu button, the time picker. Nothing here needs them.

## What the web builders must keep

Port `tokens.css` into `apps/web` as its one source of colors and sizes. After
that, change the app's copy; this folder stays as the reference it was drawn
from, not a second source.

1. Only the tokens. No color, size or radius literal in a component, except
   white on colored fills, shadows, and the few colors fixed in both schemes
   in `components.css` with a reason beside them.
2. Light and dark both, through `prefers-color-scheme` and `data-theme`.
3. AA contrast for every piece of text, in both schemes. If a new pairing is
   needed, measure it before using it.
4. Las Vegas time, rendered in `America/Los_Angeles` always, and said once per
   screen.
5. Sentence case headers. No uppercase eyebrows, no icon-bullet rows, no
   equal-column feature strips, no italic accent words, no marketing pills, no
   hero. This is a utility app.
6. 44 px tap targets (the small pill buttons extend theirs with `::after`).
7. Never an AWS logo or the re:Invent wordmark. "re:Invent" as text is fine.
8. A session abstract only for an attendee whose own agent has synced an
   abstract another attendee's agent also sent (ADR 0025, #83), as plain text. Everyone else is told the description is on
   re:Invent, and linked there.
9. The "not visible to you" state shows the public card and nothing about the
   schedule: no count, no days.

## Open points for the owner

- Indigo is a call made without you; say if you want another accent.
- The share card is light only. A dark variant is easy if you want it.
- On a wide screen the share sheet sits at the bottom, as on a phone. A
  popover from the Share button would be more iPad-like; the builders can
  decide when they build it.
- A private (`Only me`) week shows the same lock state as connections-only,
  with "Jordan keeps their week private" and no Connect hint. It is not drawn.
- Signed-out visitors to a public `/@handle` see no tab bar, and Connect asks
  them to sign in with LinkedIn. Not drawn.
