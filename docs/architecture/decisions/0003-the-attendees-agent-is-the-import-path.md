# 0003. The attendee's agent is the import path, and we keep no abstracts

Date: 2026-11-13. Status: accepted; the abstract and taxonomy part amended by ADR 0025, and the no-abstract rule fully superseded by its correction (issue #103).

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

*Amended by ADR 0025 (issue #74):* Hallway now keeps every field an agent
sends but AWS's live seat state, shows the descriptive fields to anyone who can
see the session, and shows the abstract only to an attendee whose own agent
has synced sessions (`canReadAbstract`), never on anything that leaves
Hallway. Since #83 that sync must carry an abstract another attendee's agent
also sent.

*Superseded, 2026-11-13 (issue #103, ADR 0025's correction):* AWS's public
catalog page shows every description to anyone, so "the abstract is AWS
content behind a login" was wrong for the website. Hallway now shows the
description to everyone who can see the session, still only as attendees'
agents sent it, and still never scrapes the page. The rest of this ADR, the
agent as the only import path, stands.

**Rejected:** scraping the catalog (behind login, against its use); asking users
for their Builder ID token (we would hold a credential that can reserve and
cancel their sessions).

**Cost:** a user without an agent cannot import. The web app offers manual add
from sessions already in the catalog, and a copyable prompt plus the MCP setup
lines for Claude Code and Kiro.
