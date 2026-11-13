# 0028. The owner's annotation toolbar, behind a build flag, on a note channel per checkout

Date: 2026-11-13. Status: accepted.

## Context

Issue #105. The owner: "Please enable agentation and listen for it. I'm
going to make suggestions." He annotates the live environment at
`http://192.168.0.60:8795/` from another machine. agentation is a React
toolbar: he clicks an element on the running page and writes a note, and
`agentation-mcp`, one process that is both an HTTP server and an MCP server,
stores it for an agent to read.

Out of the box every toolbar posts to port 4747 and every server keeps its
notes in `~/.agentation/store.db`, with no option to move it. On this machine
the owner's other projects already run note servers on 4747 to 4760, so a
default setup would put Hallway's notes in another project's store. void-crm
solved this (its ADR 0051, after Rally4Hallie's ADRs 0144 and 0148, and the
`agentation-channels` skill); this copies that design and changes only what
Hallway's way of serving the web app forces.

## Decision

**A channel per checkout: one port, one store, one origin allowlist.**
Copied from void-crm: `scripts/lib/note-channels.config.mjs` declares it once
and `scripts/lib/note-channel.mjs` derives everything from a checkout's real
path. The main checkout and the owner's LAN preview `reinvent-hallway-live`
share `main`: port **4761**, store `~/.agentation-stores/reinvent-hallway/main/`,
and the preview's port **8795** is always among its allowed origins. Every
other worktree gets the lowest free port from 4800 to 4999 in the machine-wide
registry `~/.agentation-stores/ports.json` (shared with the other projects,
under its lock file) and a store of its own. A server is started with
`HOME=<store dir>`, which is how its store moves; that is undocumented
behaviour of the package, so it is proved on every start. It listens on
`0.0.0.0`, and the toolbar posts to `window.location.hostname` on the
channel's port, so from the owner's machine that is `192.168.0.60:4761`.

**The toolbar is in a bundle only when the build is told so, not when it is a
dev build.** void-crm keys it on `import.meta.env.DEV`, because its dev server
is Vite's. Here the web app is always a production build: `vite build
--watch` under `npm run dev` and Aspire alike (ADR 0010, 0017), so `DEV` is
false everywhere. `main.tsx` imports `src/dev/annotator.tsx` only when
`import.meta.env.VITE_NOTES === "1"`, and `VITE_NOTE_PORT` names the channel's
port. `apps/api/scripts/dev.mjs` and the AppHost's `web` resource set both
after deriving the channel; `npm run build` and any deploy set neither, and
then the condition is a constant false and the chunk is not emitted.
`scripts/check-no-toolbar.mjs` runs after the build in `npm run verify` and
fails if `apps/web/dist` names agentation or the port variable, so a refactor
that imports the toolbar unconditionally, or a build run with the flag left
in the environment, is red. A browser under automation gets no toolbar unless
the URL has `?annotate`, so an agent's screenshots are of the app.
*Rejected:* a Vite plugin that serves the port as a module (void-crm's
`note-port.ts`), because there is no Vite dev server to serve it; an
environment variable at build time is what this build has.

**Who starts the server.**
- `npm run dev` ensures its channel's server, accepting this run's port,
  before the first build, and builds with the flag only if that succeeded.
  The server is detached and outlives the dev server, as in void-crm.
- Aspire has a `notes` resource (`npm run notes -- serve --stay` with the
  app's Aspire port and, in LAN mode, the LAN port), listed under `api` with
  its URL on the dashboard. It owns a server it started and stops it on
  `npm run aspire:stop`; a server it found already running is kept, with this
  run's origins added. So in the live checkout, `HALLWAY_LAN=1
  HALLWAY_LAN_PORT=8795 HALLWAY_LAN_DASHBOARD_PORT=8797 npm run aspire` brings
  up the main channel on 4761 with the owner's origins.
- `.mcp.json` runs `scripts/notes-mcp.mjs`, which ensures the session's
  channel and execs the MCP half against it, writing nothing to stdout but
  the protocol. In the main checkout that is the orchestrator reading the
  owner's notes.

**Every start is proved.** A note is written over HTTP to a throwaway
session, read back from the channel's `store.db` directly, and deleted; the
shared `~/.agentation/store.db` must not have changed; a preflight from each
own origin must answer 204 and from a foreign one 403. A start that fails is
stopped and said; the app still runs, without the toolbar under `npm run dev`.

**A refused note is recorded.** The server runs with the preload
`scripts/lib/note-server-guard.mjs`, which appends each non-2xx write to
`refused.jsonl` in the store directory (outside every checkout) and, before a
create, fills an empty `elementPath` and stringifies object fields.
`npm run notes -- pending` prints a `REFUSED` line when there are new ones.

**Agents read through the cwd.** `npm run notes -- pending | show | reply |
resolve | ack | refused | channel | serve | restart | gc`. A subagent
inherits its orchestrator's MCP connection, so worktree builders use
`npm run notes`. `agentation` 3.1.2 and `agentation-mcp` 1.3.2 are pinned
exactly (1.3.2 is the first that reads the host and origin settings), and the
server runs from the checkout's own `node_modules`, never `npx`.

## Consequences

- The owner annotates on `http://192.168.0.60:8795`; the orchestrator reads
  from the main checkout with `npm run notes -- pending` or the MCP tools.
- One small Node process per checkout while its app runs, plus any a dev
  run left behind, until `npm run notes -- gc` after the worktree is gone.
- The main channel is down between the live preview's Aspire runs unless an
  MCP session in the main checkout started it; a note cannot be written while
  the preview is down anyway.
- The store's location rests on `os.homedir()` reading `HOME`. If a release
  of `agentation-mcp` changes that, the start proof fails loudly instead of
  notes landing in the shared store.
- Each Aspire start gets a new app port from Aspire, so a main server that an
  MCP session started is restarted once to add that port's origins; its store
  survives, and the MCP half reconnects on its next call.
