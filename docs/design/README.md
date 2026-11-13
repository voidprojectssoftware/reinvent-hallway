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

**Accent: Void Projects' violet (issue #106, ADR 0027).** Hallway is a Void
Projects piece, so its tint is the brand violet of voidprojects.ai
(`--color-primary`, `oklch(0.6534 0.1876 301.62)`, in that site's
`src/routes/layout.css`), kept at the brand's hue and chroma and moved in
lightness until every use passes AA: `#8147c4` (`oklch(0.53 …)`) in light,
`#bb83ff` (`oklch(0.72 …)`) in dark. The brand value itself is 3.45:1 on white,
and its `--color-primary-strong` (L 0.58) 4.17:1 on the grouped background.
It replaced the indigo of #10 (`#5856d6` / `#9896ff`). Measured on the
tokens (light / dark):

| Use | Pairing | Light | Dark |
| --- | --- | --- | --- |
| Links, tinted text | tint on a cell | 5.78 | 6.32 |
| Tinted text on the page | tint on `--bg` | 5.18 | 7.80 |
| Tinted text in a grouped cell's second level | tint on `--cell2` | 5.18 | 5.18 |
| Gray buttons, `.minibtn` | tint on `--fill` over a cell | 5.03 | 4.74 |
| Gray button on the page | tint on `--fill` over `--bg` | 4.52 | 6.32 |
| Selected tab label | tint on `--bar` over `--bg` | 5.45 | 6.96 |
| Calendar "+N more" | tint on `--tint-bg` over a cell | 4.88 | 4.91 |
| Solid buttons, selected day, sidebar row | `--on-tint` on tint | 5.78 | 6.32 |
| Selected day's weekday (0.85 opacity) | `--on-tint` at 0.85 on tint | 4.65 | 4.98 |

The light tint passes on gray over the page too (indigo was 4.42:1 there),
but the rule below that a gray button sits on a cell still stands. Why not
iOS blue: `#007aff` is 4.0:1 on white, and every darkened blue reads as
LinkedIn's, which sits next to Hallway in every post. AWS's orange and squid
ink belong to AWS, and Hallway must not look like an AWS product. The
iOS look is otherwise unchanged: system font, system grays, Apple's green,
orange and red. `--av-1` (the first avatar hue, and the icon tiles) is the
light tint in both schemes, as it was indigo before.

**The credit: "Made by Void Projects", once per screen size.** The orbit
mark and the words, linking to `https://voidprojects.ai/websites` in a new
tab, as every Void-built site carries it (voidprojects-site,
`docs/websites/how-to/add-the-footer-badge.md`). On a wide screen it is the
foot of the sidebar; on a phone, the end of Settings; on the sign-in screen,
under the buttons. A footnote in the secondary label, never a banner or a
pill. The share card's footer says "Hallway · by Void Projects". The mark
is a fixed copy (`apps/web/src/brand/void-mark.svg`, seed 3 of
voidprojects.ai's `/api/mark.svg`), never fetched from that site, and it is
the favicon. Page titles stay "<Screen> · Hallway"; `og:site_name` is
"Hallway by Void Projects".

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

- The share card and composer picture carry the credit in words only; the
  mark is not drawn on them.
- The share card is light only. A dark variant is easy if you want it.
- On a wide screen the share sheet sits at the bottom, as on a phone. A
  popover from the Share button would be more iPad-like; the builders can
  decide when they build it.
- A private (`Only me`) week shows the same lock state as connections-only,
  with "Jordan keeps their week private" and no Connect hint. It is not drawn.
- Signed-out visitors to a public `/@handle` see no tab bar, and Connect asks
  them to sign in with LinkedIn. Not drawn.
