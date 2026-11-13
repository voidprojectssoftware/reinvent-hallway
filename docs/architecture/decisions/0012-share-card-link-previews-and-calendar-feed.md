# 0012. Sharing: the share card renderer, link previews and the calendar feed

Date: 2026-11-13. Status: accepted.

Issue #16 put three read paths on the Worker that leave Hallway: the link
preview of `/@handle`, the share card PNG at `/og/{handle}.png`, and the
calendar feed at `/cal/{token}.ics`. ADR 0005 already put the first two on
the Worker; these are the choices it left open.

## The share card: Satori 0.32 and resvg-wasm, with Inter

- **Satori lays the card out, resvg rasterizes it.** The card is
  `docs/design/share-card.html`: two lines of text, five day columns of wrapped
  session titles, a footer. Satori (Vercel, MPL-2.0) turns a tree of
  flexbox-styled nodes into an SVG with the text as glyph paths;
  `@resvg/resvg-wasm` 2.6.2 (MPL-2.0) turns that into a PNG. The tree is
  plain objects (`apps/api/src/sharing/share-card.ts`), not JSX, so the API
  needs no React.
- **Why not the Halloween site's way.** Its plan picture (its ADR 0013) is
  drawn with no library at all, 2-bit palette pixels written straight into PNG
  scanlines, which fits a map of roads and dots inside the free plan's 10 ms of
  CPU. This card is mostly proportional text that wraps and clamps; drawing
  that by hand means writing a font rasterizer and a line breaker. Satori and
  resvg are also what `workers-og` wraps.
- **Pinned to Satori 0.32.0, the last release before HarfBuzz.** From 0.33
  Satori shapes text with `harfbuzzjs`, which compiles its WebAssembly from
  bytes embedded in the bundle and reads `import.meta.url`. Workers refuse to
  compile WebAssembly from bytes at run time, and the 0.63 build failed in
  `wrangler dev` with `Cannot read properties of undefined (reading 'href')`
  in `harfbuzzjs/hb.js`. 0.32's `satori/standalone` build takes its one
  module, `yoga.wasm`, from the caller. Upgrading Satori means proving the new
  version renders under `npm run dev` first.
- **The pin carries an advisory, held off by construction.** `npm audit`
  reports GHSA-wx4j-mvgx-mqwp (moderate) against Satori up to 0.33.4: some
  values are not escaped when written into the SVG, and the fix (0.33.5) came
  after HarfBuzz. Here every attribute and style is a constant of
  `share-card.ts`, and what attendees and agents typed (names, session titles)
  is text, which Satori writes as glyph outlines, not markup. The SVG goes
  only to resvg, never to a browser. `sharing.test.ts` puts markup in a name
  and a title and fails if any of it reaches the SVG.
- **The WebAssembly and fonts are modules, handed in.** `worker-renderer.ts`
  imports `satori/yoga.wasm` and `@resvg/resvg-wasm/index_bg.wasm` (wrangler
  compiles `.wasm` imports at deploy) and the `.woff` files (a `Data` rule in
  `wrangler.jsonc`). `png.ts` takes them as arguments, so the tests build the
  same renderer from the files on disk. Only `index.ts` imports
  `worker-renderer.ts`.
- **Inter, SIL Open Font License 1.1,** from `@fontsource/inter` 5.3.0,
  Latin and Latin Extended subsets at 400, 600 and 700, as WOFF (Satori 0.32
  reads TTF, OTF and WOFF, not WOFF2). The app's system font does not exist on
  a Worker, and SF Pro may not be redistributed. The OFL allows embedding the
  font in software and drawing with it; the PNG carries glyph shapes, not the
  font. Only Latin is in the bundle now; see the next point.
- **Other scripts: fallback fonts from the static assets, only when the text
  needs them (issue #40, 2026-11-13).** Inter's Latin Extended, Cyrillic,
  Cyrillic Extended, Greek, Greek Extended and Vietnamese subsets, then Noto
  Sans JP, KR and SC (Google, SIL Open Font License 1.1, from `@fontsource`
  5.3.1) in Fontsource's chunks of a few hundred characters, CJK at 400 and
  700 only. `fallback-fonts.ts` maps each code point to the first subset in
  that order whose `unicode.json` range holds it (Han goes to JP before SC).
  `png.ts` hands Satori a `loadAdditionalAsset` only when some string on the
  card is outside Inter Latin; Satori calls it with just the characters no
  loaded font draws, and the Worker fetches those files from `env.ASSETS`
  (`/share-card-fonts/`) once per isolate. Satori then keeps them for later
  cards. CJK is 13 MB a weight for three languages, so it cannot go in the
  bundle; `scripts/copy-card-fonts.mjs` copies the 720 files (20 MB, with each
  family's licence) into the assets directory, run by wrangler's `build`
  command before every `wrangler dev` and deploy. Each subset has its own
  family name, because Satori keeps one font per name and weight: the
  Latin Extended file bundled before this as a second "Inter" was never used,
  and "Łukasz" drew a missing-glyph box. A character no subset has (emoji,
  Thai, Hebrew, Devanagari) still draws as Inter's box, and the Worker logs its
  code points (not the text) with `console.warn`. Arabic and Hebrew would also
  need shaping and right-to-left order, which Satori 0.32 does not do.
  Rejected: Google Fonts' `text=` API at render time (a third party on every
  non-Latin card, sent the characters of someone's name); all of CJK in the
  bundle (over the 3 MiB limit by itself).
- **Cost, measured 2026-11-13.** The Worker's upload went from 1,824.58 KiB
  (327.89 KiB gzipped) to 5,337.71 KiB (1,695.63 KiB gzipped), under the free
  plan's 3 MiB compressed limit. resvg's WebAssembly is 2.4 MiB of it. One
  card takes about 85 ms locally (median of 12 requests under `npm run dev`,
  most of it Satori and resvg), far over the free plan's 10 ms of CPU a
  request. **Deploying this needs Workers Paid** (30 s of CPU by default), or
  a cache in front so a card is drawn once per version. Nothing is deployed,
  so that choice waits for the owner.
- **Cost of the fallbacks, measured 2026-11-13.** Upload 5,400.43 KiB (1,708.80
  KiB gzipped) before, 5,467.34 KiB (1,654.48 KiB gzipped) after: the three
  Latin Extended files left the bundle and the four `unicode.json` indexes
  came in. A Latin card renders as before (Node, median of 60: 60.2 to 61.0
  ms before, 61.2 to 63.2 ms after, within the noise of a shared machine;
  under `npm run dev`, 94 to 107 ms a request both before and after). A card
  needing fallbacks pays once per isolate for the fetch and parse (the first
  Cyrillic, Japanese or mixed card took 86 to 125 ms in Node, against 63 ms
  warm) and then about what a Latin card costs (64 to 71 ms).

## Link previews: tags in index.html, always the anonymous view

- `/@handle` answers with the web app's `index.html` (ADR 0010) with the Open
  Graph and Twitter tags inserted before `</head>` and the title replaced. A
  plain string insert, not HTMLRewriter: the document is our own build output
  with one `</head>`, and the insert runs unchanged under Node's tests.
- **The tags describe what an anonymous visitor may see, whoever asks.** A
  preview card is shown to everyone a link is posted to, so a connections-only
  or private schedule previews as the name and headline alone, with
  `robots: noindex`, and its image is the card without the week.
- **An empty week previews the same way, still indexable (issue #41).** A
  public schedule with nothing in it says "On Hallway for re:Invent 2026."
  and its card says "Nothing planned this week yet." instead of "0 sessions"
  over five empty columns (`showsWeek` in `share-card.ts`, used by both).
- **`og:image` carries a version**, `?v=` and sixteen hex digits of the
  SHA-256 of everything the card shows (name, headline, whether the schedule
  is visible, and each shown session's id, intent, code, title, times and
  place). LinkedIn caches previews and their images hard; a changed schedule
  is a new image URL. A hidden entry changing changes nothing shown, so it
  does not change the version, and the version of a schedule the public cannot
  see never moves with it.

## The share card follows the asker

_Superseded by ADR 0026 (#70): `/og/{handle}.png` is now always the
anonymous card, and the owner's picture is `/api/me/share-image.png`._

`/og/{handle}.png` resolves the actor like `/api`: a fetcher is anonymous and
gets the public view; the owner signed in gets their own week to download and
post as a picture. Hidden entries stay out even for the owner
(`shareableEntries` in the domain), because the owner is about to show it to
others. An anonymous card whose URL names the current version may be cached
for a day (`immutable`); any other anonymous card for five minutes; a
signed-in card is `private, no-store`.

## The calendar feed

- `/cal/{token}.ics` finds the owner by the token (`calendar_feeds.token` is
  unique; no migration) and serves their schedule minus hidden entries.
  Rotating replaces the token, so the old URL finds no one and answers 404.
- Times are Las Vegas wall time, `TZID=America/Los_Angeles` with a VTIMEZONE
  written out (US rules since 2007); an event in another zone would get UTC
  times. All-day sessions are `VALUE=DATE`. Lines fold at 75 octets without
  splitting a UTF-8 character; text escapes backslash, semicolon, comma and
  newline.
- `UID` is `{sessionId}.{attendeeId}@hallway`: the same across polls, syncs
  and rotations, so a moved session updates in place.
- The token is never logged by our code and the response is
  `private, no-store` with `no-referrer`. `wrangler dev` prints request paths,
  token included, to the local terminal; a deployed Worker has observability
  off, and turning it on would log feed URLs.

Rejected: HTMLRewriter for the tags (no gain on our own file, and untestable
under Node); `workers-og` (a wrapper over an older Satori and resvg, last
released 2025); drawing the card without a library (above); a fixed
`og:image` URL (LinkedIn would keep the first picture it saw).
