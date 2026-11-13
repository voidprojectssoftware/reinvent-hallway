// The owner's notes from the web app's annotation toolbar: read them, answer them,
// and close them when the change is on main. ADR 0028.
//
//   npm run notes -- pending              every open note (pending and acknowledged)
//   npm run notes -- show <id>            one note, whole, with its thread
//   npm run notes -- reply <id> <text>    answer on the note's thread, leave it open
//   npm run notes -- resolve <id> <reply> close it, saying what landed and where
//   npm run notes -- ack <id> [<text>]    picked up, not done; stays on the list
//   npm run notes -- refused [--all]      writes the server refused, with each lost note
//   npm run notes -- channel              which channel this checkout is on, and its server
//   npm run notes -- serve [--app-port <p>]... [--stay]
//                                         start this channel's server (if it is not
//                                         running) accepting the app on each port given;
//                                         --stay keeps watching it (Aspire's `notes`)
//   npm run notes -- restart              replace this channel's server, keeping its origins
//   npm run notes -- gc                   stop and archive channels whose worktree is gone
//
// The server is this checkout's note channel, derived from the working
// directory by `scripts/lib/note-channel.mjs`, the same derivation `npm run dev`,
// the AppHost and `.mcp.json` use. So in a worktree this reads that
// worktree's notes and in the main checkout it reads the owner's.
// `AGENTATION_URL` overrides it.
//
// WHY HTTP AND NOT THE MCP TOOLS
// A subagent inherits its orchestrator's MCP connection, so its agentation
// tools read the orchestrator's channel. This reads the channel of the
// directory it runs in. The MCP tools also drop `fullPath`, `cssClasses`,
// `boundingBox` and `nearbyElements`, which `show` prints.
//
// WHY `resolve` TAKES A REPLY
// The reply is what the owner reads to learn what was done. A note closed in
// silence cannot be told from one closed to tidy the list. Resolve when the
// change is on main, because the owner's preview runs main.

import process, { argv, cwd, env, exit } from "node:process";
import {
  channelFor,
  collectGarbage,
  ensureNoteServer,
  healthy,
  restartNoteServer,
  runningServer,
  stopServer,
} from "./lib/note-channel.mjs";
import {
  describeRefusal,
  readRefusals,
  refusalLogFor,
  refusalReport,
  unseenRefusals,
} from "./lib/note-refusals.mjs";

const CHANNEL = await channelFor(cwd());
const BASE = (env.AGENTATION_URL ?? CHANNEL.url).replace(/\/+$/, "");

const die = (message) => {
  console.error(message);
  exit(1);
};

const call = async (path, options = {}, { fatal = true } = {}) => {
  let response;
  try {
    response = await fetch(`${BASE}${path}`, options);
  } catch (cause) {
    if (!fatal) return null;
    die(
      `Cannot reach the ${CHANNEL.channel} note server at ${BASE}.\n` +
        `  Start it with:  npm run notes -- serve   (npm run dev and npm run aspire start it too)\n` +
        `  Underlying error: ${cause.message}`,
    );
  }
  if (!response.ok) {
    const body = await response.text();
    if (!fatal) return null;
    die(
      `${options.method ?? "GET"} ${path} answered ${response.status}: ${body}`,
    );
  }
  return response.status === 204 ? null : response.json();
};

const json = (method, body) => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

const OPEN = new Set(["pending", "acknowledged"]);

// `GET /pending` keeps only `status = 'pending'`, so an acknowledged note
// (picked up, not done) would drop off the list. Every session is read
// instead and the open ones kept.
const everyNote = async () => {
  const sessions = await call("/sessions");
  const notes = [];
  for (const session of sessions) {
    const full = await call(`/sessions/${encodeURIComponent(session.id)}`);
    for (const note of full?.annotations ?? [])
      notes.push({ ...note, url: note.url ?? session.url });
  }
  return notes;
};

const RESTART = "npm run notes -- restart   (in this checkout)";
const refusalLines = () =>
  refusalReport(CHANNEL, runningServer(CHANNEL).server, "notes", {
    restart: RESTART,
  });

const pending = async () => {
  for (const line of refusalLines()) console.log(`${line}\n`);
  const open = (await everyNote())
    .filter((note) => OPEN.has(note.status ?? "pending"))
    .sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0));
  if (open.length === 0) {
    console.log(`No open notes on the ${CHANNEL.channel} channel (${BASE}).`);
    return;
  }
  console.log(
    `${open.length} open note${open.length === 1 ? "" : "s"} on the ${CHANNEL.channel} channel (${BASE}):\n`,
  );
  for (const note of open) {
    const when = note.timestamp
      ? new Date(note.timestamp).toISOString().slice(0, 16).replace("T", " ")
      : "";
    console.log(
      `[${note.id}] ${note.status === "acknowledged" ? "ACK " : ""}${when}  ${note.url ?? ""}`,
    );
    console.log(
      `  element  ${note.element ?? ""}  [${note.elementPath ?? ""}]`,
    );
    if (note.selectedText) console.log(`  selected "${note.selectedText}"`);
    console.log(`  > ${note.comment}`);
    const replies = Array.isArray(note.thread) ? note.thread.length : 0;
    if (replies)
      console.log(`  (${replies} repl${replies === 1 ? "y" : "ies"})`);
    console.log("");
  }
};

const show = async (id) => {
  if (!id) die("show needs an annotation id.");
  const note = await call(`/annotations/${encodeURIComponent(id)}`);
  console.log(JSON.stringify(note, null, 2));
};

const reply = async (id, text) => {
  if (!id || !text) die("reply needs an id and the text of the reply.");
  await call(
    `/annotations/${encodeURIComponent(id)}/thread`,
    json("POST", { role: "agent", content: text }),
  );
  console.log(`replied: ${id}`);
};

const close = async (status, id, text) => {
  if (!id || !text) die(`${status} needs an id and a reply saying why.`);
  await call(
    `/annotations/${encodeURIComponent(id)}`,
    json("PATCH", {
      status,
      resolvedBy: "agent",
      resolvedAt: new Date().toISOString(),
    }),
  );
  // The reply goes on the note's own thread, where the owner wrote it. The
  // status is already set, so a failed reply is said rather than fatal.
  const posted = await call(
    `/annotations/${encodeURIComponent(id)}/thread`,
    json("POST", { role: "agent", content: text }),
    { fatal: false },
  );
  console.log(
    `${status}: ${id}${posted ? "" : "  (status set, but the reply did not post)"}`,
  );
};

const refused = (all) => {
  const records = readRefusals(CHANNEL.storeDir);
  const shown = all ? records : records.slice(-20);
  if (records.length === 0) {
    console.log(
      `The ${CHANNEL.channel} note server has refused no writes on record.`,
    );
  } else {
    console.log(
      `${records.length} refused write${records.length === 1 ? "" : "s"} on record for ${CHANNEL.channel}` +
        `${shown.length < records.length ? `, the newest ${shown.length} (--all for every one)` : ""}:\n`,
    );
    for (const record of shown) console.log(`${describeRefusal(record)}\n`);
  }
  console.log(`From ${refusalLogFor(CHANNEL.storeDir)}.`);
  unseenRefusals(CHANNEL.storeDir, "notes");
};

const sayStarted = (action, server, proof) => {
  console.log(
    `${CHANNEL.channel}: ${action}, pid ${server.pid} on ${CHANNEL.port}, store ${CHANNEL.storeFile}`,
  );
  if (proof) console.log(`proof: ${JSON.stringify(proof)}`);
};

/** Every `--app-port <p>` given: the ports the app is reached on, whose
 * origins the server must accept. */
const appPorts = (args) =>
  args.flatMap((arg, i) =>
    arg === "--app-port" && Number.isInteger(Number(args[i + 1]))
      ? [Number(args[i + 1])]
      : [],
  );

/**
 * Aspire's `notes` resource (apphost.mts): stays up while the app does, so
 * the dashboard shows the channel, and starts the server again if it stops
 * answering. It owns a server it started: on SIGTERM (`npm run aspire:stop`)
 * it stops that one, which is what Aspire does to its resources' children
 * anyway, said here so it does not depend on how. A server it found already
 * running (started by `npm run dev`, `npm run notes -- serve` or the MCP
 * wrapper) is left running.
 */
const stay = async (devPorts, first) => {
  let owned = first.action === "kept" ? null : first.server;
  console.log(
    `Watching the ${CHANNEL.channel} channel on ${CHANNEL.port}; ${owned ? "stopping this stops its note server" : "its note server was already running and stays when this stops"}.`,
  );
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, async () => {
      const { server } = runningServer(CHANNEL);
      if (owned && server?.pid === owned.pid) await stopServer(server);
      exit(0);
    });
  }
  for (;;) {
    await new Promise((done) => setTimeout(done, 30_000));
    if (await healthy(CHANNEL.url)) continue;
    try {
      const { action, server, proof } = await ensureNoteServer(CHANNEL, {
        devPorts,
        say: console.log,
      });
      if (action !== "kept") owned = server;
      sayStarted(action, server, proof);
    } catch (error) {
      console.error(error.message);
    }
  }
};

const [command, ...rest] = argv.slice(2);

switch (command) {
  case "pending":
    await pending();
    break;
  case "show":
    await show(rest[0]);
    break;
  case "reply":
    await reply(rest[0], rest.slice(1).join(" "));
    break;
  case "resolve":
    await close("resolved", rest[0], rest.slice(1).join(" "));
    break;
  case "dismiss":
    await close("dismissed", rest[0], rest.slice(1).join(" "));
    break;
  case "ack": {
    await call(
      `/annotations/${encodeURIComponent(rest[0] ?? "")}`,
      json("PATCH", { status: "acknowledged" }),
    );
    if (rest.length > 1) await reply(rest[0], rest.slice(1).join(" "));
    else console.log(`acknowledged: ${rest[0]}`);
    break;
  }
  case "refused":
    refused(rest.includes("--all"));
    break;
  case "channel": {
    const { server, why } = runningServer(CHANNEL);
    console.log(
      `channel   ${CHANNEL.channel}${CHANNEL.main ? "  (the owner annotates here)" : ""}`,
    );
    console.log(`checkout  ${CHANNEL.root}`);
    console.log(`port      ${CHANNEL.port}`);
    console.log(`store     ${CHANNEL.storeFile}`);
    console.log(
      `server    ${server ? `pid ${server.pid}, started ${server.startedAt}` : `not running (${why})`}`,
    );
    if (server)
      console.log(
        `origins   ${server.origins.join(" ") || "(none: only requests with no Origin)"}`,
      );
    console.log(`answering ${(await healthy(CHANNEL.url)) ? "yes" : "no"}`);
    console.log(
      `refusals  ${server?.refusedLog ? `recorded, ${readRefusals(CHANNEL.storeDir).length} on record` : "no server"}`,
    );
    break;
  }
  case "serve":
  case "restart": {
    const devPorts = appPorts(rest);
    let started;
    try {
      const run = command === "serve" ? ensureNoteServer : restartNoteServer;
      started = await run(CHANNEL, { devPorts, say: console.log });
      sayStarted(started.action, started.server, started.proof);
    } catch (error) {
      die(error.message);
    }
    if (command === "serve" && rest.includes("--stay")) await stay(devPorts, started);
    break;
  }
  case "gc": {
    const { removed, kept } = await collectGarbage({ say: console.log });
    console.log(
      `${removed.length} channel(s) collected, ${kept} worktree channel(s) kept.`,
    );
    break;
  }
  default:
    console.log(
      [
        "The owner's notes from the web app's annotation toolbar. ADR 0028.",
        "",
        "  npm run notes -- pending",
        "  npm run notes -- show <id>",
        "  npm run notes -- reply <id> <text>",
        '  npm run notes -- resolve <id> "landed in #NNN: what changed"',
        "  npm run notes -- dismiss <id> <why>",
        "  npm run notes -- ack <id> [<text>]",
        "  npm run notes -- refused [--all]",
        "  npm run notes -- channel | serve [--app-port <p>]... [--stay] | restart | gc",
        "",
        `Channel: ${CHANNEL.channel}, server ${BASE}  (override with AGENTATION_URL).`,
      ].join("\n"),
    );
}
