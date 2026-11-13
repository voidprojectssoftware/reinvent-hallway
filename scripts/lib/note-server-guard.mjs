// A preload for `agentation-mcp server`, so a note it refuses is written down
// and a note it would refuse for a reason that is ours to fix is not refused.
// ADR 0028.
//
//   node --import <this file> node_modules/agentation-mcp/dist/cli.js server --port N
//
// `startServer` in `note-channel.mjs` is the only thing that starts a note
// server and it always starts it this way, with `NOTE_REFUSED_LOG` naming the
// channel's `refused.jsonl`.
//
// WHY A PRELOAD
// The package is pinned and is not ours: `node_modules` is not patched here,
// and a fork is a second thing to keep in step with every release. Its server
// is one `http.createServer(handler)` call in `startHttpServer`, reached through
// `require("http")`, so replacing `createServer` on that module before the CLI
// loads wraps the one handler there is and nothing else. The other options
// were worse: a proxy in front of the port is a second process to keep alive
// and a second port the toolbar would have to learn, and reading
// `server.log` cannot work because the server never writes the status there.
//
// WHAT IT DOES TO A REQUEST
// Nothing, unless the request is a write to a note route (`isWrite`). For one
// of those it reads the whole body first, so it can record it, and hands the
// server's handler a request whose body is that same text, or, for a create,
// the normalized text (`normalizeCreateBody`). It then watches the answer and
// appends one line to the refusal log when the status is not 2xx. A failure
// inside the guard itself is caught and the request is passed through
// untouched: a broken recorder must not become a server that refuses notes.

import http from 'node:http';
import { dirname } from 'node:path';
import { Readable } from 'node:stream';

import {
  appendRefusal,
  isCreate,
  isWrite,
  normalizeCreateBody,
  reasonOf,
  refusalLogFor,
} from './note-refusals.mjs';

const target = process.env.NOTE_REFUSED_LOG;
const normalize = process.env.NOTE_GUARD_NORMALIZE !== '0';

let logFile = null;
if (target) {
  try {
    // `refusalLogFor` takes the directory and refuses one inside a checkout.
    logFile = refusalLogFor(dirname(target));
  } catch (error) {
    process.stderr.write(`[guard] ${error.message} Recording nothing.\n`);
  }
}

const record = (entry) => {
  if (!logFile) return;
  try {
    appendRefusal(logFile, entry);
  } catch (error) {
    process.stderr.write(`[guard] could not record a refusal: ${error.message}\n`);
  }
};

/**
 * A stand-in for `req` whose body is `text`. The server's `parseBody` listens
 * for `data`, `end` and `error`; everything else (`method`, `url`, `headers`,
 * `socket`) is read off the real request.
 */
const withBody = (req, text) => {
  const replay = Readable.from(text ? [Buffer.from(text, 'utf8')] : []);
  const streamish = new Set([
    'on',
    'once',
    'addListener',
    'removeListener',
    'off',
    'pipe',
    'read',
    'resume',
    'pause',
    'setEncoding',
  ]);
  return new Proxy(req, {
    get(object, key) {
      if (streamish.has(key)) return replay[key].bind(replay);
      if (key === Symbol.asyncIterator)
        return replay[Symbol.asyncIterator].bind(replay);
      const value = Reflect.get(object, key, object);
      return typeof value === 'function' ? value.bind(object) : value;
    },
  });
};

/** Collects what the handler writes as its answer, without changing it. */
const watchAnswer = (res) => {
  const chunks = [];
  const keep = (chunk, encoding) => {
    if (chunk === undefined || chunk === null || typeof chunk === 'function') return;
    chunks.push(
      Buffer.isBuffer(chunk)
        ? chunk
        : Buffer.from(String(chunk), typeof encoding === 'string' ? encoding : 'utf8'),
    );
  };
  const write = res.write;
  const end = res.end;
  res.write = function (chunk, encoding, ...rest) {
    keep(chunk, encoding);
    return write.call(this, chunk, encoding, ...rest);
  };
  res.end = function (chunk, encoding, ...rest) {
    keep(chunk, encoding);
    return end.call(this, chunk, encoding, ...rest);
  };
  return () => Buffer.concat(chunks).toString('utf8').slice(0, 4096);
};

const readAll = (req) =>
  new Promise((done, fail) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => done(Buffer.concat(chunks).toString('utf8')));
    req.on('error', fail);
  });

const guard = (handler) =>
  async function guarded(req, res) {
    let path;
    let method;
    try {
      method = req.method ?? 'GET';
      path = new URL(req.url ?? '/', 'http://guard.invalid').pathname;
    } catch {
      return handler.call(this, req, res);
    }
    if (!isWrite(method, path)) return handler.call(this, req, res);

    let text = '';
    let normalized = [];
    let forward = req;
    try {
      if (method !== 'OPTIONS' && method !== 'DELETE') {
        text = await readAll(req);
        let sent = text;
        if (normalize && isCreate(method, path) && text) {
          try {
            const result = normalizeCreateBody(JSON.parse(text));
            if (result.changed.length > 0) {
              normalized = result.changed;
              sent = JSON.stringify(result.body);
            }
          } catch {
            // Not JSON. The server says so in its own words, and that is recorded.
          }
        }
        forward = withBody(req, sent);
      }
    } catch (error) {
      process.stderr.write(
        `[guard] could not read a ${method} ${path} body: ${error.message}\n`,
      );
      return handler.call(this, withBody(req, text), res);
    }

    const answer = watchAnswer(res);
    res.once('finish', () => {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        if (normalized.length > 0)
          process.stderr.write(
            `[guard] ${method} ${path} saved after: ${normalized.join(', ')}\n`,
          );
        return;
      }
      record({
        method,
        path,
        status: res.statusCode,
        error: reasonOf(answer()),
        origin: req.headers?.origin ?? null,
        body: text,
        normalized,
      });
      process.stderr.write(`[guard] ${method} ${path} refused ${res.statusCode}\n`);
    });
    return handler.call(this, forward, res);
  };

const createServer = http.createServer;
http.createServer = function (...args) {
  const at = args.findIndex((arg) => typeof arg === 'function');
  if (at !== -1) args[at] = guard(args[at]);
  return createServer.apply(this, args);
};
