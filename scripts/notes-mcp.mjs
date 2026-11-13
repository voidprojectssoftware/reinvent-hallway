// What `.mcp.json` runs: the annotation MCP tools, pointed at the note channel
// of the checkout the session was opened in. ADR 0028.
//
// It derives the channel from its working directory, which the MCP client sets
// to the session's project directory, makes sure that channel's note server is
// running (`scripts/lib/note-channel.mjs`), and then runs the installed
// `agentation-mcp` with `server --mcp-only --http-url <that channel>`. The MCP
// half holds no store of its own, it calls the HTTP server, so a session reads
// exactly the notes the toolbar in its own checkout posts.
//
// THIS PROCESS'S STDOUT IS THE MCP PROTOCOL
// Nothing here may print to stdout. Every line this file says goes to stderr,
// which the MCP client keeps as a log, and the child inherits stdin and stdout
// so the protocol passes straight through.
//
// A SUBAGENT DOES NOT GET ITS OWN COPY OF THIS
// An orchestrator's subagents inherit the orchestrator's MCP connection, so
// their `agentation_*` tools read the orchestrator's channel, whichever worktree
// they are working in. A worktree agent reads its own notes with
// `npm run notes`, which derives the channel from its own working directory.
// AGENTS.md ("Running things") says so where an agent will read it.

import { spawn } from "node:child_process";
import { cwd, exit, kill, pid } from "node:process";

import { channelFor, cliFor, ensureNoteServer } from "./lib/note-channel.mjs";

const say = (line) => process.stderr.write(`notes-mcp: ${line}\n`);

let channel;
try {
  channel = await channelFor(cwd());
} catch (error) {
  say(`no note channel for ${cwd()}: ${error.message}`);
  exit(1);
}

try {
  const { action, server } = await ensureNoteServer(channel, { say });
  say(
    `${channel.channel} channel, ${action} pid ${server.pid} on ${channel.port}, store ${channel.storeFile}`,
  );
} catch (error) {
  // The tools still start, and every call through them fails with the server's
  // own connection error. Refusing to start would leave the session with no
  // tools at all and nothing on screen saying why.
  say(`the ${channel.channel} note server is not running: ${error.message}`);
}

const child = spawn(
  process.execPath,
  [cliFor(channel), "server", "--mcp-only", "--http-url", channel.url],
  // `HOME` is the channel's store directory here too. The MCP half was
  // measured not to open a store at all (its tools call the HTTP server), and
  // if a later version starts to, it opens this channel's rather than
  // `~/.agentation/store.db`, which is another project's.
  { stdio: "inherit", env: { ...process.env, HOME: channel.storeDir } },
);
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, () => child.kill(signal));
}
child.on("exit", (code, signal) => {
  if (signal) kill(pid, signal);
  else exit(code ?? 0);
});
