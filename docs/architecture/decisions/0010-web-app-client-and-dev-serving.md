# 0010. Web app: a hand-written API client over the contracts, and one origin in dev

Date: 2026-11-13. Status: accepted.

Issue #14 set up `apps/web` (ADR 0005). It made three choices later screens
copy.

- **The API client is written by hand over `fetch` and parses every answer
  with the contract's own zod schema** (`apps/web/src/api/client.ts`). One
  function per call names its path and its schema; a refusal arrives as one
  error type, `ApiFailure`, whose `kind` is the handler outcome's kind when the
  server sent the `Error` resource, else `unreachable` or `unexpected`.
  *Why:* `packages/contracts` is already the single source of the shapes, and
  the web app may import it (ADR 0002); parsing at the boundary turns a
  server and client that disagree into a named failure rather than an
  undefined deep in a screen. *Rejected:* generating a client from
  `/api/openapi.json` (openapi-typescript and openapi-fetch). It types paths
  as well as bodies, but it is a second copy of the contracts, needs the
  Worker running (or a build step that boots it) to regenerate, and adds two
  dependencies and a generated file that drifts until someone reruns it. The
  cost of the choice taken: a path is a string in one file, and a typo there
  is caught by the call failing, not by the compiler. The bundle carries zod
  (the contracts are zod), which is fine at this size.
- **`npm run dev` has no Vite dev server.** It builds `apps/web` once, then
  runs `vite build --watch` beside `wrangler dev`, which serves
  `apps/web/dist` as the Worker's static assets. One origin, no proxy, and
  deep links, the SPA fallback and the Worker's own paths (`/api`, `/mcp`,
  `/cal`) behave exactly as built. No hot reload: reload the page. *Rejected:*
  Vite's dev server with a proxy to wrangler, which serves `/@...` paths
  itself (`/@vite/client`, `/@fs/`, `/@id/`) beside our `/@handle`, and would
  test a routing setup production never runs.
- **The Worker serves `/@handle` itself.** The static assets layer re-encodes
  each path segment with `encodeURIComponent` and redirects when that differs,
  so `/@jane` answered 307 to `/%40jane`. `/@*` is in `run_worker_first` and
  `apps/api/src/person-page.ts` answers with `index.html` under the URL as
  typed. ADR 0005 already puts this path on the Worker for link previews.
