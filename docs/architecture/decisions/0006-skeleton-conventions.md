# 0006. Skeleton conventions: MCP transport, outcome mapping, dev sign-in, dev ports

Date: 2026-11-13. Status: accepted.

Issue #8 built ADR 0002's shape end to end for one resource, Event. These are
the choices it made that ADR 0002 left open, so later slices copy them instead
of re-deciding.

- **MCP transport.** `@modelcontextprotocol/sdk` 1.32.2 (ADR 0002 names it),
  with its `WebStandardStreamableHTTPServerTransport`: it takes a fetch
  `Request` and returns a `Response`, so it runs on Workers unchanged, where the
  Node transport wants `req`/`res`. Stateless (no `sessionIdGenerator`): each
  request builds a fresh server and transport, so no Durable Object or session
  store. JSON responses, not SSE, until a tool streams. *Rejected:* Cloudflare's
  `agents` (`McpAgent`), which brings Durable Objects for sessions we do not
  keep; the SDK's v2 `@modelcontextprotocol/server` (void-crm's choice), which
  would mean amending ADR 0002 for no gain at this size.
- **Tool output schemas are inlined.** A contract schema with `.meta({ id })`
  converts to `{ $ref, definitions }` with no top-level `type`, and the SDK's
  client refuses such a tool list. `mcp/server.ts` passes a copy of the shape.
- **One mapper each, and routes list every refusal.** `outcome-http.ts` maps
  error kinds to statuses; `mcp/outcome-mcp.ts` maps a refusal to a tool error
  whose text is the same `Error` resource. A route's `responses` spreads
  `errorResponses` (all kinds), because a handler's types allow any kind.
- **Dev sign-in is a stand-in** (`apps/api/src/auth/dev-actor.ts`) until the
  identity issue: `Bearer dev:<id>`, only with `DEV_SIGN_IN=1` from the
  git-ignored `.dev.vars` and only on a loopback host. Any other bearer token is
  refused, not downgraded to anonymous. `wrangler types` reads
  `.dev.vars.example`, so the generated `Env` does not depend on a local file.
- **Dev servers are per worktree.** `npm run dev` derives its port from the
  checkout path, takes the next free one if busy, and persists D1 under the
  checkout. wrangler refuses a missing assets directory, so it creates an empty
  `apps/web/dist` until the web app builds one there.
