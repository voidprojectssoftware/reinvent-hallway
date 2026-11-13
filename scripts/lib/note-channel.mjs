// Which annotation channel a checkout is on, and the note server behind it.
// ADR 0028.
//
// One function, `channelFor`, turns the real path of a checkout into
// everything a caller needs: the channel's name, its port, its store directory,
// the file the store lands in, and the URL to read notes from. Every caller
// goes through it: `npm run dev` and the Aspire AppHost (which build the
// toolbar with the channel's port and start its server), `npm run notes`, and
// `scripts/notes-mcp.mjs`, which is what `.mcp.json` runs. So the port a
// toolbar posts to and the port an agent reads from cannot drift apart:
// neither is written down anywhere but `note-channels.config.mjs`, and a
// worktree's is in the registry.
//
// THE TWO KINDS OF CHANNEL
//   main      the main checkout and the owner's LAN preview
//             (`reinvent-hallway-live`),
//             on the configured port. The owner annotates here.
//   <name>    any other worktree, named after its directory, on a port from
//             the band that the registry gave it the first time it asked.
//
// WHY A REGISTRY AND NOT A HASH OF THE PATH
// Two note servers on one port fail silently: the loser's toolbar posts to the
// winner and nothing errors at all. About 60 worktrees on 200 ports put the
// chance that some pair collides above 99.9% (the birthday problem). The
// registry, `~/.agentation-stores/ports.json`, is shared with every other
// project on this machine that uses the same design, so its entries and its
// lock are respected rather than owned. A
// registry that hands out the lowest free port under a lock cannot collide
// while the band has room, and says so when it does not.
//
// WHY `HOME`
// `agentation-mcp` puts its store at `join(os.homedir(), '.agentation',
// 'store.db')` and has no option to move it. `os.homedir()` reads `$HOME` on
// Linux, so a server started with `HOME=<store dir>` writes
// `<store dir>/.agentation/store.db`. That is an undocumented behavior of the
// package rather than an interface, so **every start is proved**: a note is
// written over HTTP, read back out of the expected file directly, and deleted,
// the shared `~/.agentation/store.db` is checked not to have moved, and the
// origin allowlist is asked from inside and outside (`proveChannel`,
// `proveOrigins`). A start that fails the proof is stopped and reported.

import { execFileSync, spawn } from 'node:child_process';
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from 'node:fs';
import { createConnection, createServer } from 'node:net';
import { homedir, userInfo } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';

import { NOTE_CHANNELS } from './note-channels.config.mjs';
import { refusalLogFor } from './note-refusals.mjs';

/** The preload every note server is started with. ADR 0028. */
const GUARD_URL = new URL('./note-server-guard.mjs', import.meta.url).href;

/** A refusal this module wants said to a person, as opposed to a bug. */
export class NoteChannelError extends Error {}

/** Where every channel's store and the port registry live. Outside every
 * checkout, for the reason the personal-information invariant gives: a note can
 * hold anything typed into it. */
export const defaultStoresRoot = () => join(homedir(), '.agentation-stores');

export const REGISTRY_FILE = 'ports.json';

const realOrResolved = (path) => {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
};

/**
 * The checkout `start` is inside, and the main checkout it belongs to, both as
 * real paths. Read from git's own files rather than by running git: a worktree's
 * `.git` is a file naming its directory under the main checkout's `.git`, and
 * that directory's `commondir` names the shared one.
 *
 * @param {string} start any directory inside a checkout
 * @returns {{ root: string, mainRoot: string }}
 */
export function findCheckout(start) {
  let dir = realOrResolved(start);
  for (;;) {
    const dotGit = join(dir, '.git');
    let stats = null;
    try {
      stats = statSync(dotGit);
    } catch {
      // Not here. Keep climbing.
    }
    if (stats?.isDirectory()) return { root: dir, mainRoot: dir };
    if (stats?.isFile()) {
      const pointer = /^gitdir:\s*(.+?)\s*$/m.exec(readFileSync(dotGit, 'utf8'));
      if (!pointer) throw new NoteChannelError(`${dotGit} does not name a gitdir.`);
      const gitDir = resolve(dir, pointer[1]);
      let common = gitDir;
      try {
        common = resolve(
          gitDir,
          readFileSync(join(gitDir, 'commondir'), 'utf8').trim(),
        );
      } catch {
        // No `commondir`: a submodule or a separate git dir. Its own checkout is
        // then the main one.
        return { root: dir, mainRoot: dir };
      }
      return { root: dir, mainRoot: realOrResolved(dirname(common)) };
    }
    const up = dirname(dir);
    if (up === dir)
      throw new NoteChannelError(`${start} is not inside a git checkout.`);
    dir = up;
  }
}

const isAlive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
};

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/**
 * Runs `work` while holding `lockPath`, an `O_EXCL` file naming the holder's
 * pid. A lock whose holder has died, or that is older than `staleMs`, is broken
 * rather than waited on forever, because the failure it would otherwise produce
 * is a dev server that hangs at startup with nothing on screen.
 *
 * @template T
 * @param {string} lockPath
 * @param {() => Promise<T>} work
 * @param {{ timeoutMs?: number, staleMs?: number }} [options]
 * @returns {Promise<T>}
 */
export async function withLock(
  lockPath,
  work,
  { timeoutMs = 30_000, staleMs = 60_000 } = {},
) {
  mkdirSync(dirname(lockPath), { recursive: true });
  const deadline = Date.now() + timeoutMs;
  let fd;
  for (;;) {
    try {
      fd = openSync(lockPath, 'wx');
      break;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
    let holder = null;
    try {
      holder = JSON.parse(readFileSync(lockPath, 'utf8'));
    } catch {
      // Being written right now, or gone already. Ask again.
    }
    let age = 0;
    try {
      age = Date.now() - statSync(lockPath).mtimeMs;
    } catch {
      continue;
    }
    // A holder that died, a lock older than any honest holder takes, or a file
    // nobody ever finished writing.
    if ((holder && !isAlive(holder.pid)) || age > staleMs || (!holder && age > 2000)) {
      try {
        unlinkSync(lockPath);
      } catch {
        // Somebody else broke it first.
      }
      continue;
    }
    if (Date.now() > deadline) {
      throw new NoteChannelError(
        `Waited ${timeoutMs / 1000}s for ${lockPath}, held by pid ${holder?.pid ?? '?'}.`,
      );
    }
    await sleep(25 + Math.random() * 50);
  }
  try {
    writeSync(fd, JSON.stringify({ pid: process.pid, at: new Date().toISOString() }));
    closeSync(fd);
    return await work();
  } finally {
    try {
      unlinkSync(lockPath);
    } catch {
      // Already broken as stale by a waiter. Nothing left to release.
    }
  }
}

/** @returns {{ version: 1, worktrees: Record<string, { project: string, channel: string, port: number, assignedAt: string }> }} */
export function readRegistry(storesRoot = defaultStoresRoot()) {
  let data;
  try {
    data = JSON.parse(readFileSync(join(storesRoot, REGISTRY_FILE), 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return { version: 1, worktrees: {} };
    throw new NoteChannelError(
      `${join(storesRoot, REGISTRY_FILE)} is not the registry this writes: ${error.message}`,
    );
  }
  if (!data || typeof data.worktrees !== 'object') {
    throw new NoteChannelError(
      `${join(storesRoot, REGISTRY_FILE)} has no worktrees map.`,
    );
  }
  return data;
}

const writeRegistry = (storesRoot, data) => {
  const path = join(storesRoot, REGISTRY_FILE);
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(data, null, 2)}\n`);
  renameSync(temporary, path);
};

/**
 * True when nothing is listening on `port`: it can be bound on every interface
 * and nothing answers a connection on loopback. Both, because a process bound
 * to one address can leave the other half looking free.
 *
 * @param {number} port
 */
export async function portIsFree(port) {
  const bindable = await new Promise((done) => {
    const probe = createServer();
    probe.once('error', () => done(false));
    probe.listen({ port, host: '0.0.0.0', exclusive: true }, () =>
      probe.close(() => done(true)),
    );
  });
  if (!bindable) return false;
  const answered = await new Promise((done) => {
    const socket = createConnection({ port, host: '127.0.0.1' });
    socket.once('connect', () => {
      socket.destroy();
      done(true);
    });
    socket.once('error', () => done(false));
    socket.setTimeout(500, () => {
      socket.destroy();
      done(false);
    });
  });
  return !answered;
}

const RESERVED_NAMES = new Set(['main', '_archived']);

/**
 * The registry entry for `root`, assigning one under the lock if there is
 * none. An entry, once written, is kept: the same worktree is on the same port
 * and the same store for its whole life, which is what makes its notes
 * findable. The port is the lowest one in the band that no entry holds and
 * nothing is listening on at the time of asking.
 *
 * @param {string} root real path of the worktree
 * @param {{ storesRoot?: string, band?: { first: number, last: number }, project?: string, isFree?: (port: number) => Promise<boolean> }} [options]
 */
export async function assignPort(root, options = {}) {
  const storesRoot = options.storesRoot ?? defaultStoresRoot();
  const band = options.band ?? NOTE_CHANNELS.band;
  const project = options.project ?? NOTE_CHANNELS.project;
  const isFree = options.isFree ?? portIsFree;
  return withLock(join(storesRoot, `${REGISTRY_FILE}.lock`), async () => {
    const registry = readRegistry(storesRoot);
    const existing = registry.worktrees[root];
    if (existing) return existing;

    const held = new Set(Object.values(registry.worktrees).map((entry) => entry.port));
    let port = null;
    for (let candidate = band.first; candidate <= band.last; candidate += 1) {
      if (held.has(candidate)) continue;
      if (await isFree(candidate)) {
        port = candidate;
        break;
      }
    }
    if (port === null) {
      throw new NoteChannelError(
        `Every port from ${band.first} to ${band.last} is registered or in use. ` +
          `\`npm run notes -- gc\` frees the ones whose worktree is gone.`,
      );
    }

    const taken = new Set(
      Object.values(registry.worktrees)
        .filter((entry) => entry.project === project)
        .map((entry) => entry.channel),
    );
    const base =
      basename(root)
        .replace(/[^A-Za-z0-9._-]/g, '-')
        .replace(/^\.+/, '') || 'worktree';
    let channel = base;
    for (let n = 2; taken.has(channel) || RESERVED_NAMES.has(channel); n += 1) {
      channel = `${base}-${n}`;
    }

    const entry = { project, channel, port, assignedAt: new Date().toISOString() };
    registry.worktrees[root] = entry;
    writeRegistry(storesRoot, registry);
    return entry;
  });
}

/**
 * @typedef {object} Channel
 * @property {string} project
 * @property {string} channel   `main` or the worktree's channel name
 * @property {boolean} main
 * @property {string} root      real path of the checkout asked about
 * @property {string} mainRoot  real path of the main checkout
 * @property {number} port
 * @property {string} storeDir  what the server's `HOME` is set to
 * @property {string} storeFile where its SQLite store lands
 * @property {string} serverFile the `server.json` naming the running server
 * @property {string} logFile
 * @property {string} url       where to read notes from on this machine
 */

/**
 * Everything about the channel for the checkout containing `dir`.
 *
 * @param {string} dir
 * @param {{ storesRoot?: string, band?: { first: number, last: number }, isFree?: (port: number) => Promise<boolean> }} [options]
 * @returns {Promise<Channel>}
 */
export async function channelFor(dir, options = {}) {
  const storesRoot = options.storesRoot ?? defaultStoresRoot();
  const { root, mainRoot } = findCheckout(dir);
  const mains = NOTE_CHANNELS.main.checkouts.map((relative) =>
    realOrResolved(join(mainRoot, relative)),
  );
  let channel;
  let port;
  if (mains.includes(root)) {
    channel = 'main';
    port = NOTE_CHANNELS.main.port;
  } else {
    const entry = await assignPort(root, { ...options, storesRoot });
    channel = entry.channel;
    port = entry.port;
  }
  return describeChannel({ storesRoot, root, mainRoot, channel, port });
}

/** The derived paths for a channel whose name and port are already known. */
export function describeChannel({
  storesRoot = defaultStoresRoot(),
  root,
  mainRoot,
  channel,
  port,
}) {
  const storeDir = join(storesRoot, NOTE_CHANNELS.project, channel);
  return {
    project: NOTE_CHANNELS.project,
    channel,
    main: channel === 'main',
    root,
    mainRoot,
    port,
    storeDir,
    storeFile: join(storeDir, '.agentation', 'store.db'),
    serverFile: join(storeDir, 'server.json'),
    logFile: join(storeDir, 'server.log'),
    url: `http://127.0.0.1:${port}`,
  };
}

/**
 * The origins a channel's note server accepts a toolbar from: each of the
 * machine's host names on each dev port given, plus the owner's LAN preview port
 * on the main channel.
 *
 * @param {Pick<Channel, 'main'>} channel
 * @param {number[]} devPorts
 */
export function originsFor(channel, devPorts = []) {
  const ports = new Set(devPorts.filter((port) => Number.isInteger(port) && port > 0));
  if (channel.main) ports.add(NOTE_CHANNELS.main.viewPort);
  return [...ports]
    .sort((a, b) => a - b)
    .flatMap((port) => NOTE_CHANNELS.devHosts.map((host) => `http://${host}:${port}`));
}

/** The `agentation-mcp` CLI this checkout has installed, or the main
 * checkout's. Never `npx`: that fetches whatever is newest, which is how two
 * sessions on this machine ran two different versions. */
export function cliFor(channel) {
  for (const root of [channel.root, channel.mainRoot]) {
    const cli = join(root, 'node_modules', 'agentation-mcp', 'dist', 'cli.js');
    if (existsSync(cli)) return cli;
  }
  throw new NoteChannelError(
    `agentation-mcp is not installed in ${channel.root} or ${channel.mainRoot}. Run npm ci.`,
  );
}

const commandOf = (pid) => {
  try {
    return execFileSync('ps', ['-o', 'args=', '-p', String(pid)], {
      encoding: 'utf8',
    }).trim();
  } catch {
    return null;
  }
};

/**
 * The note server this channel's `server.json` names, when `ps` agrees that
 * pid is an `agentation-mcp server` on this channel's port. Otherwise null,
 * with `why` saying which half failed, so a reused pid is never signaled.
 *
 * @param {Channel} channel
 */
export function runningServer(channel) {
  let recorded;
  try {
    recorded = JSON.parse(readFileSync(channel.serverFile, 'utf8'));
  } catch {
    return { server: null, why: 'no server.json' };
  }
  if (!Number.isInteger(recorded?.pid))
    return { server: null, why: 'server.json names no pid' };
  const command = commandOf(recorded.pid);
  if (command === null)
    return { server: null, why: `pid ${recorded.pid} is not running` };
  const ours =
    command.includes('agentation-mcp') &&
    / server( |$)/.test(command) &&
    new RegExp(`--port ${channel.port}(\\s|$)`).test(command) &&
    !command.includes('--mcp-only');
  if (!ours) {
    return {
      server: null,
      why: `pid ${recorded.pid} is not this channel's note server, ps says: ${command}`,
    };
  }
  return {
    server: {
      ...recorded,
      origins: Array.isArray(recorded.origins) ? recorded.origins : [],
      command,
    },
    why: null,
  };
}

/** True when the server on `url` answers its health route. */
export async function healthy(url) {
  try {
    const response = await fetch(`${url}/health`, {
      signal: AbortSignal.timeout(2000),
    });
    if (!response.ok) return false;
    return (await response.json())?.status === 'ok';
  } catch {
    return false;
  }
}

/** SIGTERM, five seconds, then SIGKILL. Only ever called with a server
 * `runningServer` confirmed. Resolves to whether it is gone. */
export async function stopServer(server) {
  try {
    process.kill(server.pid, 'SIGTERM');
  } catch {
    return !isAlive(server.pid);
  }
  for (let waited = 0; waited < 5000 && isAlive(server.pid); waited += 100)
    await sleep(100);
  if (isAlive(server.pid)) {
    try {
      process.kill(server.pid, 'SIGKILL');
    } catch {
      // Gone between the check and the signal.
    }
    for (let waited = 0; waited < 3000 && isAlive(server.pid); waited += 100)
      await sleep(100);
  }
  return !isAlive(server.pid);
}

const tail = (path, lines = 15) => {
  try {
    return readFileSync(path, 'utf8').trimEnd().split('\n').slice(-lines).join('\n');
  } catch {
    return '(no log)';
  }
};

/**
 * Starts the channel's note server, detached so it outlives whatever asked
 * for it, and waits for it to answer. The environment is built rather than
 * inherited: a parent's `AGENTATION_API_KEY` would put the server in cloud
 * mode and a parent's `AGENTATION_STORE=memory` would keep nothing, and either
 * would pass the health check.
 *
 * @param {Channel} channel
 * @param {string[]} origins
 * @param {{ cli?: string, guardNormalize?: boolean }} [options]
 */
export async function startServer(
  channel,
  origins,
  { cli = cliFor(channel), guardNormalize = true } = {},
) {
  mkdirSync(channel.storeDir, { recursive: true });
  const log = openSync(channel.logFile, 'a');
  writeSync(log, `\n--- ${new Date().toISOString()} starting on ${channel.port}\n`);
  // The guard records every write the server refuses into `refused.jsonl` in
  // this store directory and normalizes a create body before the server binds
  // it. ADR 0028. `refusalLogFor` refuses a store inside a checkout.
  const refusedLog = refusalLogFor(channel.storeDir);
  const child = spawn(
    process.execPath,
    ['--import', GUARD_URL, cli, 'server', '--port', String(channel.port)],
    {
      cwd: channel.storeDir,
      detached: true,
      stdio: ['ignore', log, log],
      env: {
        PATH: process.env.PATH ?? '/usr/bin:/bin',
        HOME: channel.storeDir,
        AGENTATION_HOST: '0.0.0.0',
        AGENTATION_CORS_ORIGINS: origins.join(','),
        NOTE_REFUSED_LOG: refusedLog,
        ...(guardNormalize ? {} : { NOTE_GUARD_NORMALIZE: '0' }),
      },
    },
  );
  closeSync(log);
  let exited = null;
  child.once('exit', (code, signal) => {
    exited = { code, signal };
  });
  child.unref();

  const server = {
    pid: child.pid,
    port: channel.port,
    channel: channel.channel,
    root: channel.root,
    startedAt: new Date().toISOString(),
    origins,
    cli,
    // A server started before ADR 0028 has no such key, and the readers say
    // that it is recording nothing rather than reporting no refusals.
    refusedLog,
    guard: guardNormalize ? 'record+normalize' : 'record',
  };
  writeFileSync(channel.serverFile, `${JSON.stringify(server, null, 2)}\n`);

  for (let waited = 0; waited < 15_000; waited += 100) {
    if (exited) break;
    if (await healthy(channel.url)) return server;
    await sleep(100);
  }
  if (!exited) await stopServer(server);
  throw new NoteChannelError(
    `The note server for ${channel.channel} did not answer on ${channel.port}` +
      `${exited ? ` (it exited ${exited.code ?? exited.signal})` : ''}. Its log:\n${tail(channel.logFile)}`,
  );
}

/**
 * Proves a running server keeps its notes where this module says: writes a
 * note over HTTP, reads it back over HTTP, reads it back **out of the expected
 * file** directly, deletes it, and checks it is gone from both. This is the
 * check that the `HOME` behavior the whole design rests on still holds.
 *
 * The proof leaves one empty session behind, because the server has no route
 * that deletes a session. An empty session carries no note and the board does
 * not print one.
 *
 * @param {Channel} channel
 */
export async function proveChannel(channel, { sharedStore = sharedStoreFile() } = {}) {
  const sharedBefore = await snapshotStore(sharedStore);
  const call = async (method, path, body) => {
    const response = await fetch(`${channel.url}${path}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(5000),
    });
    const text = await response.text();
    return { status: response.status, json: text ? JSON.parse(text) : null };
  };
  const fail = (what) => {
    throw new NoteChannelError(
      `The proof of ${channel.channel}'s store failed: ${what}`,
    );
  };

  const session = await call('POST', '/sessions', {
    url: 'http://channel-proof.invalid/',
  });
  if (session.status !== 201 || !session.json?.id)
    fail(`POST /sessions answered ${session.status}`);
  const marker = `channel proof ${channel.channel} ${Date.now()}`;
  const created = await call(
    'POST',
    `/sessions/${encodeURIComponent(session.json.id)}/annotations`,
    {
      comment: marker,
      element: 'channel-proof',
      elementPath: 'channel-proof',
      x: 0,
      y: 0,
      timestamp: Date.now(),
    },
  );
  const id = created.json?.id;
  if (created.status !== 201 || !id)
    fail(`POST annotations answered ${created.status}`);

  const readBack = await call('GET', `/annotations/${encodeURIComponent(id)}`);
  if (readBack.json?.comment !== marker) fail('the note did not read back over HTTP');

  if (!existsSync(channel.storeFile)) fail(`there is no store at ${channel.storeFile}`);
  const inFile = await rowInStore(channel.storeFile, id);
  if (!inFile)
    fail(
      `the note is not in ${channel.storeFile}, so the server is writing somewhere else`,
    );

  const deleted = await call('DELETE', `/annotations/${encodeURIComponent(id)}`);
  if (deleted.status >= 300) fail(`DELETE answered ${deleted.status}`);
  const gone = await call('GET', `/annotations/${encodeURIComponent(id)}`);
  if (gone.status !== 404)
    fail(`the note was still there after DELETE (${gone.status})`);
  if (await rowInStore(channel.storeFile, id))
    fail('the note is still in the file after DELETE');

  const sharedAfter = await snapshotStore(sharedStore);
  if (JSON.stringify(sharedBefore) !== JSON.stringify(sharedAfter))
    fail(
      `the shared store ${sharedStore} changed during the proof ` +
        `(${JSON.stringify(sharedBefore)} to ${JSON.stringify(sharedAfter)}), so a note may have landed there`,
    );

  return {
    storeFile: channel.storeFile,
    annotationId: id,
    sessionId: session.json.id,
    sharedStore: { file: sharedStore, ...sharedAfter },
  };
}

/** The store every unconfigured `agentation-mcp` on this machine writes:
 * `~/.agentation/store.db` of the real user, whatever `HOME` this process has. */
export const sharedStoreFile = () =>
  join(userInfo().homedir, '.agentation', 'store.db');

/** The mtime and annotation count of a store, or `missing`. Read-only. */
async function snapshotStore(file) {
  let mtimeMs;
  try {
    mtimeMs = statSync(file).mtimeMs;
  } catch {
    return { missing: true };
  }
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const { n } = db.prepare('SELECT COUNT(*) AS n FROM annotations').get();
    return { mtimeMs, annotations: n };
  } catch {
    return { mtimeMs, annotations: null };
  } finally {
    db.close();
  }
}

/** The status a preflight from `origin` gets on the channel's `/sessions`. */
export async function preflight(channel, origin) {
  const response = await fetch(`${channel.url}/sessions`, {
    method: 'OPTIONS',
    headers: { Origin: origin, 'Access-Control-Request-Method': 'POST' },
    signal: AbortSignal.timeout(3000),
  });
  return response.status;
}

/** An origin no channel ever lists, for the outside half of the proof. */
export const FOREIGN_ORIGIN = 'http://foreign.invalid:1';

/**
 * Proves the server's allowlist: a preflight from each of its own origins is
 * 204 and one from a foreign origin is 403. Throws on the first that is not.
 *
 * @param {Channel} channel
 * @param {string[]} origins
 */
export async function proveOrigins(channel, origins) {
  const results = [];
  for (const origin of origins) {
    const status = await preflight(channel, origin);
    results.push({ origin, status });
    if (status !== 204)
      throw new NoteChannelError(
        `A preflight from ${origin}, one of ${channel.channel}'s own origins, answered ${status}, not 204.`,
      );
  }
  const status = await preflight(channel, FOREIGN_ORIGIN);
  results.push({ origin: FOREIGN_ORIGIN, status });
  if (status !== 403)
    throw new NoteChannelError(
      `A preflight from a foreign origin answered ${status}, not 403: ${channel.channel}'s server accepts strangers.`,
    );
  return results;
}

/** Whether `id` is a row in the store at `file`, read-only and straight off
 * the disk rather than through the server being proved. */
async function rowInStore(file, id) {
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    return Boolean(db.prepare('SELECT 1 FROM annotations WHERE id = ?').get(id));
  } finally {
    db.close();
  }
}

/**
 * Makes sure this channel's note server is running, ours, answering, and
 * accepts a toolbar from every origin `devPorts` implies. Starts one if none
 * is running; keeps a running one that already covers those origins; replaces
 * one that is not answering or does not cover them (with the union, so the
 * other dev server it was serving keeps working). **Refuses**, with a
 * `NoteChannelError`, when the channel's port is held by anything that is not
 * this channel's server: the toolbar would post to it and nothing would fail.
 *
 * @param {Channel} channel
 * @param {{ devPorts?: number[], cli?: string, say?: (line: string) => void }} [options]
 * @returns {Promise<{ action: 'kept' | 'started' | 'restarted', server: { pid: number, origins: string[] }, proof: object | null }>}
 */
export async function ensureNoteServer(
  channel,
  { devPorts = [], cli, say = () => {} } = {},
) {
  mkdirSync(channel.storeDir, { recursive: true });
  return withLock(join(channel.storeDir, 'ensure.lock'), async () => {
    let origins = originsFor(channel, devPorts);
    const { server: running } = runningServer(channel);
    if (running) {
      const answering = await healthy(channel.url);
      const missing = origins.filter((origin) => !running.origins.includes(origin));
      if (answering && missing.length === 0)
        return { action: 'kept', server: running, proof: null };
      say(
        answering
          ? `Restarting ${channel.channel}'s note server (pid ${running.pid}) to accept ${missing.join(', ')}.`
          : `${channel.channel}'s note server (pid ${running.pid}) is not answering. Replacing it.`,
      );
      origins = [...new Set([...running.origins, ...origins])];
      if (!(await stopServer(running))) {
        throw new NoteChannelError(
          `pid ${running.pid} survived SIGKILL. Not starting a second server.`,
        );
      }
    }
    if (!(await portIsFree(channel.port))) {
      throw new NoteChannelError(
        `Port ${channel.port} belongs to the ${channel.channel} note channel and something else is holding it. ` +
          `Not starting a server and not moving the channel: a toolbar posting there would reach a stranger. ` +
          `See what it is with:  ss -ltnp 'sport = :${channel.port}'`,
      );
    }
    const server = await startServer(channel, origins, cli ? { cli } : {});
    let proof;
    try {
      proof = await proveChannel(channel);
      proof.origins = await proveOrigins(channel, origins);
    } catch (error) {
      await stopServer(server);
      throw error;
    }
    return { action: running ? 'restarted' : 'started', server, proof };
  });
}

/**
 * Replaces this channel's running server with a new one accepting exactly the
 * origins the old one did, and proves it. For picking up a change to how a
 * server is started (ADR 0028's guard) without waiting for a dev server to
 * ask: `ensureNoteServer` keeps a healthy server, which is right on every
 * other day. Starts one if none is running. Refuses a port held by a stranger,
 * as `ensureNoteServer` does.
 *
 * @param {Channel} channel
 * @param {{ cli?: string, say?: (line: string) => void }} [options]
 */
export async function restartNoteServer(channel, { cli, say = () => {} } = {}) {
  mkdirSync(channel.storeDir, { recursive: true });
  return withLock(join(channel.storeDir, 'ensure.lock'), async () => {
    const { server: running } = runningServer(channel);
    const origins = [
      ...new Set([...(running?.origins ?? []), ...originsFor(channel, [])]),
    ];
    if (running) {
      say(`Stopping ${channel.channel}'s note server, pid ${running.pid}.`);
      if (!(await stopServer(running)))
        throw new NoteChannelError(
          `pid ${running.pid} survived SIGKILL. Not starting a second server.`,
        );
    }
    if (!(await portIsFree(channel.port)))
      throw new NoteChannelError(
        `Port ${channel.port} belongs to the ${channel.channel} note channel and something else is holding it. ` +
          `See what it is with:  ss -ltnp 'sport = :${channel.port}'`,
      );
    const server = await startServer(channel, origins, cli ? { cli } : {});
    let proof;
    try {
      proof = await proveChannel(channel);
      proof.origins = await proveOrigins(channel, origins);
    } catch (error) {
      await stopServer(server);
      throw error;
    }
    return { action: running ? 'restarted' : 'started', server, proof };
  });
}

/**
 * Stops the note servers of worktrees that no longer exist and moves their
 * stores under `_archived/`, freeing their ports. A worktree that is still
 * there is left alone whether or not its server is running: nothing here
 * stops an idle server, because idle is what a server waiting for the owner
 * looks like.
 *
 * @param {{ storesRoot?: string, say?: (line: string) => void }} [options]
 */
export async function collectGarbage({
  storesRoot = defaultStoresRoot(),
  say = () => {},
} = {}) {
  return withLock(join(storesRoot, `${REGISTRY_FILE}.lock`), async () => {
    const registry = readRegistry(storesRoot);
    const removed = [];
    let kept = 0;
    for (const [root, entry] of Object.entries(registry.worktrees)) {
      if (entry.project !== NOTE_CHANNELS.project) continue;
      if (existsSync(join(root, '.git'))) {
        kept += 1;
        continue;
      }
      const channel = describeChannel({ storesRoot, root, mainRoot: root, ...entry });
      const { server } = runningServer(channel);
      if (server) {
        say(
          `Stopping ${entry.channel}'s note server, pid ${server.pid} on ${entry.port}.`,
        );
        if (!(await stopServer(server))) {
          say(
            `  pid ${server.pid} survived SIGKILL; leaving ${entry.channel} registered.`,
          );
          continue;
        }
      }
      let archived = null;
      if (existsSync(channel.storeDir)) {
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        archived = join(
          storesRoot,
          NOTE_CHANNELS.project,
          '_archived',
          `${entry.channel}-${stamp}`,
        );
        mkdirSync(dirname(archived), { recursive: true });
        renameSync(channel.storeDir, archived);
      }
      delete registry.worktrees[root];
      removed.push({ root, ...entry, archived });
      say(
        `Freed ${entry.port} (${entry.channel}); store ${archived ? `moved to ${archived}` : 'was never written'}.`,
      );
    }
    writeRegistry(storesRoot, registry);
    return { removed, kept };
  });
}
