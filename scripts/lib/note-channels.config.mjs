// Where Hallway's annotation notes go, declared once. ADR 0028.
//
// Everything that needs a note server's port, its store or the origins it
// accepts derives it from this file through `scripts/lib/note-channel.mjs`:
// `npm run dev` (apps/api/scripts/dev.mjs) and the Aspire AppHost, which both
// start the channel's server and build the toolbar with its port, `npm run
// notes`, and the MCP wrapper `.mcp.json` runs. Nothing else in the repository
// writes a note port down.
//
// WHY 4761
// The owner's other projects on this machine hold 4747 to 4760, each a note
// server of its own (4747 is every unconfigured agentation's default, 4760 is
// void-crm's). 4761 is the first port none of them uses. Ports 4800 to 4999
// are the shared worktree band, handed out through
// `~/.agentation-stores/ports.json`.
//
// The main channel is the one the owner annotates on: the main checkout and
// his LAN preview `reinvent-hallway-live` (a worktree beside it, running
// `HALLWAY_LAN=1 npm run aspire` with the app on 8795) both map to it, because
// a note written on the preview is about what the main checkout's orchestrator
// merges.

export const NOTE_CHANNELS = Object.freeze({
  // The store directory's name under `~/.agentation-stores/`. Fixed rather than
  // read off the checkout's path, so a clone somewhere else is still this
  // repository and a worktree's directory name never decides it.
  project: 'reinvent-hallway',

  main: Object.freeze({
    port: 4761,
    // Relative to the main checkout, which is found from git's own files rather
    // than from a path typed here.
    checkouts: Object.freeze(['.', '../reinvent-hallway-live']),
    // The owner's LAN preview (HALLWAY_LAN_PORT in the live checkout). Its
    // origins are always allowed on the main channel, whichever run started
    // that channel's note server.
    viewPort: 8795,
  }),

  // Every other worktree gets a port of its own from this band, recorded in
  // `~/.agentation-stores/ports.json` the first time it asks and kept after.
  band: Object.freeze({ first: 4800, last: 4999 }),

  // The names the app on this machine is reached by. A note server accepts a
  // toolbar's request only from these hosts on its own app's ports.
  devHosts: Object.freeze([
    'localhost',
    '127.0.0.1',
    'vm-dev-01',
    'vm-dev-01.lan',
    '192.168.0.60',
  ]),
});
