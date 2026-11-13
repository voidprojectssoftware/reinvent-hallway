// What a note server refused, written down where somebody will read it.
// ADR 0028.
//
// WHY THIS EXISTS
// On 2026-10-25 the owner wrote a note on `/admin/posts` while his toolbar could
// not reach the server. The toolbar kept it in his browser, drew it on his page,
// and re-sent it on every load, and the server answered every re-send with a
// 400. Its log printed `[HTTP] POST /sessions/<id>/annotations` and nothing
// else: not the status, not the reason. So a note he could see on his own page
// was a note no agent could see, and he had to type it again in chat.
//
// A refusal the toolbar swallows (it logs a `console.warn` in the owner's own
// browser and nowhere else) and the server does not record is invisible from
// both ends. This module is both halves of making it visible:
//
//   - the server side, which `note-server-guard.mjs` calls: one JSON line per
//     refused write, in `refused.jsonl` in the channel's store directory;
//   - the reader side, which `npm run notes` calls: how many refusals arrived since that reader last asked, and the
//     newest reason.
//
// And the normalizer, which is the fix for the cause that is ours to fix. It is
// pure and lives here rather than in the preload so the tests can drive it.
//
// WHERE THE FILE LIVES, AND WHAT IS IN IT
// A refused body is the owner's own words about the app, so it is
// kept on this machine only: in the channel's store directory under
// `~/.agentation-stores/`, never inside a checkout. `refusalLogFor` refuses a
// path inside any git working tree: a note can hold anything typed into it,
// including what a business record on screen said. Each line is capped at
// `MAX_LINE_BYTES`, the body first, so one pathological request cannot fill a
// disk; the file is rotated once at `MAX_FILE_BYTES`.

import {
  appendFileSync,
  existsSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';

export const REFUSED_FILE = 'refused.jsonl';
export const SEEN_FILE = 'refused-seen.json';

/** A single record is at most this many bytes, newline included. */
export const MAX_LINE_BYTES = 16 * 1024;
/** Past this, `refused.jsonl` becomes `refused.jsonl.1` and a new one starts. */
export const MAX_FILE_BYTES = 4 * 1024 * 1024;

// The write routes of agentation-mcp 1.3.2 (`routes` in its `dist/cli.js`):
// creating a note on a session, and changing, deleting, or adding a thread
// message to one. Reads are not recorded: a refused read loses nothing.
const WRITE_ROUTES = [
  /^\/sessions\/[^/]+\/annotations\/?$/,
  /^\/annotations\/[^/]+\/?$/,
  /^\/annotations\/[^/]+\/thread\/?$/,
];
const WRITE_METHODS = new Set(['POST', 'PATCH', 'DELETE']);

/** True when `path` is a route a toolbar writes a note through. */
export const isWritePath = (path) => WRITE_ROUTES.some((route) => route.test(path));

/**
 * True when a request to `method path` is one whose refusal loses a note. An
 * `OPTIONS` to a write route counts: the server answers a preflight from an
 * origin it does not accept with 403, and the browser then never sends the
 * write at all, which is the gray pill of ADR 0028 and loses the note exactly
 * as a 400 does.
 */
export const isWrite = (method, path) =>
  (WRITE_METHODS.has(method) || method === 'OPTIONS') && isWritePath(path);

/** The create route, the only one the normalizer touches. */
export const isCreate = (method, path) =>
  method === 'POST' && WRITE_ROUTES[0].test(path);

// THE NORMALIZER
//
// `insertAnnotation.run` in agentation-mcp 1.3.2 binds these fields exactly as
// the client sent them, with only `?? null` in front, and better-sqlite3
// refuses anything that is not a number, a string, a bigint, a buffer or null
// ("SQLite3 can only bind numbers, strings, bigints, buffers, and null"). So a
// toolbar that sends any of them as an object, an array or a boolean has its
// note refused with a 400 carrying that sentence. `boundingBox` and `thread`
// are stringified by the server itself and `isMultiSelect` and `isFixed` are
// coerced to 0 or 1, so they are not here.
export const TEXT_FIELDS = Object.freeze([
  'comment',
  'element',
  'elementPath',
  'selectedText',
  'nearbyText',
  'cssClasses',
  'nearbyElements',
  'computedStyles',
  'fullPath',
  'accessibility',
  'reactComponents',
  'sourceFile',
  'url',
  'intent',
  'severity',
  'authorId',
  'kind',
]);
export const NUMBER_FIELDS = Object.freeze(['x', 'y', 'timestamp']);

// Fields a client has no business setting on a create. The server overwrites
// `id`, `status` and `createdAt` itself (`addAnnotation` spreads the body and
// then sets all three), so dropping them changes nothing it stores; they are
// dropped so a refusal record does not suggest otherwise, and so a toolbar
// re-sending a note it once read back from a server cannot carry that server's
// `resolvedAt` or thread into a new row. `_syncedTo` is the toolbar's own
// localStorage marker and `elementBoundingBoxes` is drawn locally and never
// stored. The server's `sessionId` comes from the URL.
export const DROPPED_ON_CREATE = Object.freeze([
  'id',
  'status',
  'createdAt',
  'updatedAt',
  'resolvedAt',
  'resolvedBy',
  'thread',
  'sessionId',
  '_syncedTo',
]);

const textOf = (value) => {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(textOf).join(', ');
  if (value && typeof value === 'object') {
    // `computedStyles` is the one the toolbar holds both ways: a string it
    // sends, and an object (`computedStylesObj`) it draws in the popup. The
    // object form becomes the string form it would have sent.
    return Object.entries(value)
      .map(([key, inner]) => `${key}: ${textOf(inner)}`)
      .join('; ');
  }
  return String(value);
};

/**
 * Makes a create body bindable without changing what it says. Returns the new
 * body and the list of what was changed, so the guard can record a rescue.
 * A body that is not an object is returned untouched: the server's own refusal
 * of it is the right answer and is recorded.
 *
 * @param {any} body
 * @returns {{ body: any, changed: string[] }}
 */
export function normalizeCreateBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body))
    return { body, changed: [] };
  const out = { ...body };
  const changed = [];
  for (const field of DROPPED_ON_CREATE) {
    if (field in out) {
      delete out[field];
      changed.push(`dropped ${field}`);
    }
  }
  for (const field of TEXT_FIELDS) {
    const value = out[field];
    if (value === undefined || value === null || typeof value === 'string') continue;
    out[field] = textOf(value);
    changed.push(`${field} ${Array.isArray(value) ? 'array' : typeof value} to text`);
  }
  for (const field of NUMBER_FIELDS) {
    const value = out[field];
    if (value === undefined || value === null || typeof value === 'number') continue;
    const number = Number(value);
    if (Number.isFinite(number)) {
      out[field] = number;
      changed.push(`${field} ${typeof value} to number`);
    }
  }
  // A note on blank page. The toolbar's `getElementPath` stops at `<body>` and
  // `<html>` and returns the empty string for either, so a click on the page's
  // own background sends `elementPath: ""` and the server's `!body.elementPath`
  // refuses it with "comment, element, and elementPath are required". That is
  // the refusal reproduced on 2026-10-25 (ADR 0028) and the likeliest shape of
  // a note asking for something to be added where nothing is yet. The note is
  // about the page, and `fullPath` (`body.bg-surface`) or `element` (`body`)
  // says so in the toolbar's own words. Only a body that is a note at all,
  // with a comment, is filled in.
  if (typeof out.comment === 'string') {
    const nonEmpty = (value) =>
      typeof value === 'string' && value.trim() !== '' ? value : null;
    if (!nonEmpty(out.elementPath)) {
      const from = nonEmpty(out.fullPath)
        ? 'fullPath'
        : nonEmpty(out.element)
          ? 'element'
          : null;
      out.elementPath = from ? out[from] : '(the page)';
      changed.push(`elementPath empty, filled from ${from ?? 'nothing'}`);
    }
    if (!nonEmpty(out.element)) {
      const from = nonEmpty(out.fullPath) ? 'fullPath' : 'elementPath';
      out.element = out[from];
      changed.push(`element empty, filled from ${from}`);
    }
  }
  return { body: out, changed };
}

// THE RECORD

/** Cuts `text` to at most `bytes` UTF-8 bytes without splitting a character. */
const cutToBytes = (text, bytes) => {
  const buffer = Buffer.from(text, 'utf8');
  if (buffer.length <= bytes) return text;
  return buffer.subarray(0, bytes).toString('utf8').replace(/�+$/, '');
};

/**
 * One line of `refused.jsonl`, at most `max` bytes including its newline. The
 * body is what gets cut, because everything else is a handful of bytes and the
 * reason is the part a reader needs.
 *
 * @param {{ at?: string, method: string, path: string, status: number, error?: string | null, origin?: string | null, body?: string, normalized?: string[] }} entry
 * @param {number} [max]
 */
export function refusalLine(entry, max = MAX_LINE_BYTES) {
  const body = entry.body ?? '';
  const record = {
    at: entry.at ?? new Date().toISOString(),
    method: entry.method,
    path: entry.path,
    status: entry.status,
    error: entry.error ?? null,
    origin: entry.origin ?? null,
    normalized: entry.normalized?.length ? entry.normalized : undefined,
    bodyBytes: Buffer.byteLength(body, 'utf8'),
    body,
  };
  let line = `${JSON.stringify(record)}\n`;
  if (Buffer.byteLength(line, 'utf8') <= max) return line;
  // Over the cap: cut the body until the whole line fits. JSON escaping makes
  // the encoded body longer than the raw one, so measure and retry.
  record.bodyTruncated = true;
  let room =
    max - Buffer.byteLength(JSON.stringify({ ...record, body: '' }), 'utf8') - 1;
  for (; room > 0; room = Math.floor(room * 0.9)) {
    record.body = cutToBytes(body, room);
    line = `${JSON.stringify(record)}\n`;
    if (Buffer.byteLength(line, 'utf8') <= max) return line;
  }
  record.body = '';
  return `${JSON.stringify(record)}\n`;
}

/** The first error message in a server's JSON answer, or the raw text. */
export function reasonOf(text) {
  if (!text) return null;
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed.error === 'string') return parsed.error;
  } catch {
    // Not JSON. The text is the reason.
  }
  return cutToBytes(String(text), 500);
}

/** The nearest directory at or above `path` that holds a `.git`, or null. */
const insideGitTree = (path) => {
  let dir = resolve(path);
  for (;;) {
    if (existsSync(join(dir, '.git'))) return dir;
    const up = dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
};

/**
 * The refusal log for a store directory. Refuses a directory inside a git
 * working tree, because the file holds the owner's words verbatim.
 *
 * @param {string} storeDir
 */
export function refusalLogFor(storeDir) {
  const tree = insideGitTree(storeDir);
  if (tree)
    throw new Error(
      `Refusing to keep refused notes in ${storeDir}: it is inside the git working tree ${tree}.`,
    );
  return join(storeDir, REFUSED_FILE);
}

/** Appends one record, rotating the file once when it has grown too large. */
export function appendRefusal(file, entry, { maxFile = MAX_FILE_BYTES } = {}) {
  try {
    if (statSync(file).size > maxFile) renameSync(file, `${file}.1`);
  } catch {
    // No file yet.
  }
  appendFileSync(file, refusalLine(entry), { mode: 0o600 });
}

// THE READER

/** Every record in a store directory's refusal log, oldest first. */
export function readRefusals(storeDir) {
  let text;
  try {
    text = readFileSync(join(storeDir, REFUSED_FILE), 'utf8');
  } catch {
    return [];
  }
  const records = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      records.push(JSON.parse(line));
    } catch {
      // A line cut by a crash mid-write. The next one is whole.
    }
  }
  return records;
}

const readSeen = (storeDir) => {
  try {
    return JSON.parse(readFileSync(join(storeDir, SEEN_FILE), 'utf8')) ?? {};
  } catch {
    return {};
  }
};

/**
 * The refusals `reader` has not been told about, and marks them told. Each
 * reader keeps its own cursor (`pending`, `view`, `refused`), so the
 * view's check does not swallow the line `npm run notes -- pending` would have
 * printed, and the other way round.
 *
 * @param {string} storeDir
 * @param {string} reader
 * @param {{ mark?: boolean }} [options]
 * @returns {{ count: number, newest: any, total: number }}
 */
export function unseenRefusals(storeDir, reader, { mark = true } = {}) {
  const records = readRefusals(storeDir);
  const seen = readSeen(storeDir);
  const since = seen[reader] ?? '';
  const unseen = records.filter((record) => (record.at ?? '') > since);
  if (mark && records.length > 0) {
    const newestAt = records.reduce(
      (top, r) => ((r.at ?? '') > top ? r.at : top),
      since,
    );
    if (newestAt !== since) {
      try {
        writeFileSync(
          join(storeDir, SEEN_FILE),
          `${JSON.stringify({ ...seen, [reader]: newestAt }, null, 2)}\n`,
        );
      } catch {
        // A reader that cannot write its cursor says the same thing next time,
        // which is the safe direction.
      }
    }
  }
  return { count: unseen.length, newest: unseen.at(-1) ?? null, total: records.length };
}

/** One record as a reader prints it: the refusal, then the note it lost. */
export function describeRefusal(record) {
  const lines = [
    `${record.at}  ${record.method} ${record.path}  ${record.status}  ${record.error ?? '(no reason given)'}`,
  ];
  let note = null;
  try {
    note = JSON.parse(record.body);
  } catch {
    // A cut or empty body. The byte count below says which.
  }
  if (note && typeof note === 'object') {
    if (note.url) lines.push(`    page     ${note.url}`);
    if (note.element || note.elementPath)
      lines.push(`    element  ${note.element ?? ''}  [${note.elementPath ?? ''}]`);
    if (typeof note.comment === 'string') lines.push(`    > ${note.comment}`);
  } else if (record.bodyBytes) {
    lines.push(
      `    (${record.bodyBytes} bytes${record.bodyTruncated ? ', cut to fit the line' : ''}, not readable as a note)`,
    );
  }
  if (record.normalized?.length)
    lines.push(`    normalized first: ${record.normalized.join(', ')}`);
  return lines.join('\n');
}

/**
 * What a reader should say about a channel's refusals: that its server is
 * recording none, when it was started before ADR 0028, and how many refusals
 * arrived since `reader` last asked. Empty when there is nothing to say.
 *
 * @param {{ channel: string, storeDir: string }} channel
 * @param {{ pid: number, refusedLog?: string } | null} server what `runningServer` found
 * @param {string} reader
 * @param {{ restart?: string }} [options]
 */
export function refusalReport(channel, server, reader, { restart } = {}) {
  const lines = [];
  if (server && !server.refusedLog) {
    lines.push(
      `UNRECORDED  the ${channel.channel} note server (pid ${server.pid}) was started before ADR 0028, ` +
        `so a note it refuses is lost without a trace.` +
        (restart ? ` Restart it: ${restart}` : ''),
    );
  }
  const notice = refusalNotice(
    channel.channel,
    unseenRefusals(channel.storeDir, reader),
  );
  if (notice) lines.push(notice);
  return lines;
}

/**
 * The line `npm run notes -- pending` and the view print, or null when there
 * is nothing new.
 */
export function refusalNotice(channelName, { count, newest }) {
  if (count === 0) return null;
  return (
    `REFUSED  the ${channelName} note server refused ${count} write${count === 1 ? '' : 's'} since you last asked. ` +
    `Newest: ${newest.status} ${newest.error ?? '(no reason given)'} (${newest.method} ${newest.path}, ${newest.at}). ` +
    `\`npm run notes -- refused\` prints them. ADR 0028.`
  );
}
