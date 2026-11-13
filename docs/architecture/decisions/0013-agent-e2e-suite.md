# 0013. The end-to-end suite plays agents against the real Worker

Date: 2026-11-13. Status: accepted.

Issue #22 needed a test that plays the product's front door, an agent, from
AWS to Hallway and back out as planning answers.

**Decision.** `npm run test:e2e` (`e2e/`) is a black-box client: it imports
nothing of Hallway's, only the MCP SDK and the committed fixtures and spec.
A vitest global setup starts `wrangler dev` in its own process group on two
OS-chosen free ports over a fresh D1 in a temporary directory (migrations
applied first, `DEV_SIGN_IN` passed with `--var`), and tears the group down
afterwards, failure or not. The fake AWS Events MCP server is in process
(the SDK's low-level `Server` over `InMemoryTransport`) and builds its tool
list from `docs/discovery/aws-events-api/openapi-2026-11-13.json`, so the
SDK client's output-schema check holds fixtures to AWS's shapes. It runs in
`npm run verify`: about 15 seconds, and no network (proved in a network
namespace with only loopback).

**Rejected:** `unstable_dev` / `unstable_startWorker` (the same workerd, but an
unstable API, and the suite would no longer serve the Worker the way
`npm run dev` does); reusing `npm run dev`'s per-checkout port and state (a
reviewer's running dev server would collide with the suite, and old data
would leak in); a hand-written fake whose schemas could drift from the spec.
