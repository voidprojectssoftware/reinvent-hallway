# 0002. Layers, packages and stack

Date: 2026-11-13. Status: accepted.

The owner's brief: the REST API is an interface layer whose resources are the
only thing the front end knows; the MCP server is a second interface beside it
in the same host; both hand work to the same handlers; handlers reach storage
through repositories. Same shape as void-crm (its ADRs 0005 and 0006), smaller.

```
apps/api            one Cloudflare Worker: /api (Hono REST, OpenAPI from zod),
                    /mcp (MCP streamable HTTP), /cal (iCalendar), static web assets
apps/web            the front end (ADR 0005); imports packages/contracts only
packages/contracts  zod schemas for every resource, request and response
packages/domain     types and rules, imports nothing outside itself
packages/application command and query handlers; depend on repository ports
packages/infrastructure repositories (D1 via Drizzle) and in-memory fakes
```

Dependency direction, held by a boundary check in `npm run verify`:
`domain <- application <- (api, infrastructure)`, `contracts` imported by
`application`, `api` and `web`; `web` imports nothing else from the repo.

- **TypeScript, npm workspaces, Node 22, Vitest.**
- **Hono with `@hono/zod-openapi`** for REST, OpenAPI document at
  `/api/openapi.json`. **`@modelcontextprotocol/sdk`** for MCP. Each MCP tool's
  input schema is the same zod schema the REST route uses.
- **Cloudflare Workers + D1**, run locally with `wrangler dev` (local D1). No
  deploy yet: there is no deploy workflow and none is to be added without the
  owner.
- **Handlers return outcomes, not HTTP.** A handler returns `{ ok: true, value }`
  or `{ ok: false, error: { kind, message } }`; REST maps kinds to status codes
  and MCP maps them to tool errors, in one place each.
- **Auth is a port**: the handlers receive an `Actor` (attendee id, or
  anonymous). REST resolves it from a session cookie; MCP and REST both accept
  an agent token as a bearer token.
