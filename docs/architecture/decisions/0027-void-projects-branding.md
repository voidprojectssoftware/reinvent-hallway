# 0027. Void Projects branding: the violet tint, a vendored mark, one credit

Date: 2026-11-13. Status: accepted.

Issue #106: Hallway is a Void Projects piece, and the owner wants people to see
who made it. ADR 0005 gave Hallway the iOS look with an accent of its own;
this changes only the accent and adds a credit.

**Decision.**

- **The tint is voidprojects.ai's brand violet**, at the hue and chroma of
  that site's `--color-primary` (`oklch(0.6534 0.1876 301.62)`, its
  `src/routes/layout.css`), with only the lightness moved so every use passes
  AA: `#8147c4` (L 0.53) in light, `#bb83ff` (L 0.72) in dark. The brand
  value itself is 3.45:1 on white. The measurements are in
  `docs/design/README.md`; everything else of the iOS look stays.
- **The mark is a fixed copy in the repo**, `apps/web/src/brand/void-mark.svg`:
  seed 3 of voidprojects.ai's `/api/mark.svg`, unchanged, with its source in
  a comment. That endpoint draws a new mark on every request and is a
  serverless function with a cold start; Hallway must draw with that site
  down, and one mark keeps the favicon and the credit the same. The share card
  is drawn on the Worker, which may not import from `apps/web`
  (ADR 0002), so the card carries the credit in words only and the SVG has one
  copy.
- **One credit per screen size**, "Made by **Void Projects**" with the mark,
  linking to `https://voidprojects.ai/websites` in a new tab (the badge every
  Void-built site carries): the foot of the sidebar from 1000 px, the end of
  Settings below it, and the sign-in screen. The share card's footer says
  "Hallway · by Void Projects"; `og:site_name` is "Hallway by Void Projects".
  Page titles stay "<Screen> · Hallway".

**Rejected:** linking `/api/mark.svg` live (the badge doc's way; a third party
on every page load, and a different mark each time); the brand value as it is
(fails AA as text in light); the VP lettermark that void-crm uses (the orbit
mark is the primary logo, and the badge uses it); a credit on every screen
(the owner dislikes generated-looking badges and strips).
