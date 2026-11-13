# 0003. The attendee's agent is the import path, and we keep no abstracts

Date: 2026-11-13. Status: accepted.

The AWS Events API's only OAuth client is public, loopback-only, with fixed
callback ports (`docs/discovery/aws-events-api.md`). A hosted app cannot sign an
attendee in to it, and the catalog needs a registered attendee's token.

**Decision.** Hallway never calls AWS on a user's behalf. The user's agent,
already connected to the AWS Events MCP, reads `GetSchedule` and `GetSession`
and calls Hallway's `sync_my_schedule` with the session snapshots and the id
lists. Hallway's catalog is the union of those snapshots.

**We drop `abstract`** (and the other descriptive taxonomies except `topics`)
at the contract boundary: the abstract is AWS content behind a login, it is the
largest field, and the session link exists for reading it.

**Rejected:** scraping the catalog (behind login, against its use); asking users
for their Builder ID token (we would hold a credential that can reserve and
cancel their sessions).

**Cost:** a user without an agent cannot import. The web app offers manual add
from sessions already in the catalog, and a copyable prompt plus the MCP setup
lines for Claude Code and Kiro.
