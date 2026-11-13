// Which note channel a checkout is on, and the registry behind the worktree
// band. ADR 0028. Run by `npm run verify:factory`.
//
// The promise is that two checkouts never reach each other's notes, and the
// failure it replaces was silent. So it is held here: the main checkout and
// the owner's preview are the one channel on 4761; any other worktree gets a
// port of its own from the band, the same one every time; the registry keeps
// other projects' entries; a port a stranger holds is refused; origins are
// derived, never typed.
//
// Nothing here starts a note server. The fixtures are directories shaped like
// git's own files, and the registry lives in a temporary stores root.
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  NoteChannelError,
  assignPort,
  channelFor,
  describeChannel,
  ensureNoteServer,
  originsFor,
  readRegistry,
} from './note-channel.mjs';
import { NOTE_CHANNELS } from './note-channels.config.mjs';
import { normalizeCreateBody } from './note-refusals.mjs';

const scratch = mkdtempSync(join(tmpdir(), 'hallway-note-channel-'));
after(() => rmSync(scratch, { recursive: true, force: true }));

let fresh = 0;
const storesRoot = () => join(scratch, `stores-${(fresh += 1)}`);
const allFree = async () => true;

function mainCheckout(name) {
  const root = join(scratch, name, 'reinvent-hallway');
  mkdirSync(join(root, '.git', 'worktrees'), { recursive: true });
  return root;
}

function worktree(main, path) {
  const name = path.split('/').pop();
  const gitDir = join(main, '.git', 'worktrees', name);
  mkdirSync(gitDir, { recursive: true });
  writeFileSync(join(gitDir, 'commondir'), '../..\n');
  mkdirSync(path, { recursive: true });
  writeFileSync(join(path, '.git'), `gitdir: ${gitDir}\n`);
  return path;
}

describe('the main channel', () => {
  const main = mainCheckout('mapping');
  const live = worktree(main, join(main, '..', 'reinvent-hallway-live'));
  const agent = worktree(main, join(main, '.claude', 'worktrees', 'agent-x1'));

  test('is the main checkout, on 4761', async () => {
    const channel = await channelFor(main, { storesRoot: storesRoot(), isFree: allFree });
    assert.equal(channel.channel, 'main');
    assert.equal(channel.port, 4761);
    assert.equal(channel.storeDir.endsWith(join('reinvent-hallway', 'main')), true);
  });

  test("is the owner's preview, reinvent-hallway-live, from inside apps/web", async () => {
    const deep = join(live, 'apps', 'web');
    mkdirSync(deep, { recursive: true });
    const channel = await channelFor(deep, { storesRoot: storesRoot(), isFree: allFree });
    assert.equal(channel.channel, 'main');
    assert.equal(channel.port, 4761);
  });

  test('is not any other worktree, which gets a port from the band', async () => {
    const stores = storesRoot();
    const channel = await channelFor(agent, { storesRoot: stores, isFree: allFree });
    assert.equal(channel.main, false);
    assert.equal(channel.channel, 'agent-x1');
    assert.ok(channel.port >= 4800 && channel.port <= 4999);
    assert.deepEqual(Object.keys(readRegistry(stores).worktrees), [agent]);
  });
});

describe('the registry', () => {
  test('keeps other projects entries and skips their ports', async () => {
    const stores = storesRoot();
    mkdirSync(stores, { recursive: true });
    const other = {
      '/elsewhere/a': { project: 'someone-else', channel: 'a', port: 4800, assignedAt: 'x' },
    };
    writeFileSync(
      join(stores, 'ports.json'),
      JSON.stringify({ version: 1, worktrees: other }),
    );
    const entry = await assignPort('/here/b', { storesRoot: stores, isFree: allFree });
    assert.equal(entry.port, 4801);
    assert.equal(entry.project, 'reinvent-hallway');
    const saved = JSON.parse(readFileSync(join(stores, 'ports.json'), 'utf8'));
    assert.deepEqual(saved.worktrees['/elsewhere/a'], other['/elsewhere/a']);
  });

  test('gives a worktree the same port every time, and two worktrees two ports', async () => {
    const stores = storesRoot();
    const one = await assignPort('/w/one', { storesRoot: stores, isFree: allFree });
    const two = await assignPort('/w/two', { storesRoot: stores, isFree: allFree });
    const again = await assignPort('/w/one', { storesRoot: stores, isFree: allFree });
    assert.notEqual(one.port, two.port);
    assert.equal(again.port, one.port);
  });

  test('says so when the band is full', async () => {
    await assert.rejects(
      assignPort('/w/full', {
        storesRoot: storesRoot(),
        band: { first: 4800, last: 4801 },
        isFree: async () => false,
      }),
      NoteChannelError,
    );
  });
});

describe('origins', () => {
  test('a worktree accepts only its own dev port, on each host name', () => {
    const origins = originsFor({ main: false }, [5199]);
    assert.equal(origins.length, NOTE_CHANNELS.devHosts.length);
    assert.ok(origins.includes('http://192.168.0.60:5199'));
    assert.ok(!origins.some((origin) => origin.endsWith(':8795')));
  });

  test("main always accepts the owner's preview on 8795", () => {
    const origins = originsFor({ main: true }, []);
    for (const origin of [
      'http://192.168.0.60:8795',
      'http://localhost:8795',
      'http://127.0.0.1:8795',
    ])
      assert.ok(origins.includes(origin), origin);
  });
});

describe('a channel port something else holds', () => {
  test('is refused rather than shared', async () => {
    const stranger = createServer();
    await new Promise((done) => stranger.listen(0, '127.0.0.1', done));
    const { port } = stranger.address();
    const channel = describeChannel({
      storesRoot: storesRoot(),
      root: '/w/held',
      mainRoot: '/w/held',
      channel: 'held',
      port,
    });
    try {
      await assert.rejects(
        ensureNoteServer(channel, { cli: '/nonexistent/cli.js' }),
        /something else is holding it/,
      );
    } finally {
      stranger.close();
    }
  });
});

describe('the guard normalizer', () => {
  test('fills an empty elementPath on a note made on blank page', () => {
    const { body, changed } = normalizeCreateBody({
      comment: 'add a button here',
      element: 'body',
      elementPath: '',
      fullPath: 'body.bg-background',
      id: 'client-set',
    });
    assert.equal(body.elementPath, 'body.bg-background');
    assert.equal('id' in body, false);
    assert.ok(changed.length >= 2);
  });
});
