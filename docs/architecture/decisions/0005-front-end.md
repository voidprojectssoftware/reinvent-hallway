# 0005. Front end: React on Vite, the Halloween site's iOS look

Date: 2026-11-13. Status: accepted.

The owner wants the look of the Halloween weekend map
(`voidprojectssoftware/halloween-weekend-map`, `src/styles/app.css`): an iOS-style
app with large titles, inset grouped lists, system font, system colors, light and
dark, following Apple's Human Interface Guidelines.

**Decision.** `apps/web` is a React single-page app built with Vite and served
by the API Worker's static assets (SPA fallback). Styling is hand-written CSS
whose tokens are ported from the Halloween `app.css` iOS layer, minus its
Halloween layer. No component library: the look comes from the tokens.

It imports `packages/contracts` for types and nothing else from the repo, and
reaches the server only through `/api`. Pages: my schedule, a person's schedule
(`/@handle`), session, connections, settings (tokens, visibility, calendar feed,
contact import), and connect-your-agent.

`/@handle` link previews (Open Graph) and the share image are rendered on the
Worker, as the Halloween site does (`src/link-previews.ts`, `src/plan-picture.ts`),
because LinkedIn reads tags from the HTML and runs no script.

**Rejected:** Astro static like the Halloween site. Most pages here are per-user
and per-viewer, so a static build buys little.
