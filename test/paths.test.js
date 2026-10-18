'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const paths = require('../src/paths');
const { tmpPlace } = require('./helpers');

test('the shared folder is the OS per-user place, or GRAPEVINE_DIR', () => {
  assert.equal(paths.linkDir({ platform: 'darwin', env: {}, home: '/Users/ana' }), path.join('/Users/ana', 'Library', 'Application Support', 'Grapevine'));
  assert.equal(paths.linkDir({ platform: 'linux', env: { XDG_RUNTIME_DIR: '/run/user/1000' }, home: '/home/ana' }), path.join('/run/user/1000', 'grapevine'));
  assert.equal(paths.linkDir({ platform: 'linux', env: {}, home: '/home/ana' }), path.join('/home/ana', '.local', 'state', 'grapevine'));
  assert.equal(
    paths.linkDir({ platform: 'win32', env: { APPDATA: 'C:\\Users\\ana\\AppData\\Roaming' }, home: 'C:\\Users\\ana' }),
    path.join('C:\\Users\\ana\\AppData\\Roaming', 'Grapevine'),
  );
  assert.equal(paths.linkDir({ platform: 'win32', env: {}, home: 'C:\\Users\\ana' }), path.join('C:\\Users\\ana', 'AppData', 'Roaming', 'Grapevine'));
  assert.equal(paths.linkDir({ platform: 'darwin', env: { GRAPEVINE_DIR: '/tmp/x' } }), '/tmp/x');
});

test('sockets: one per app in the folder, a short /tmp folder when paths would be too long, pipes on Windows', () => {
  const mac = { platform: 'darwin', env: {}, home: '/Users/ana', uid: 501 };
  assert.equal(paths.socketPath('pear-drops', mac), path.join('/Users/ana', 'Library', 'Application Support', 'Grapevine', 'pear-drops.sock'));
  const deep = { platform: 'linux', env: { GRAPEVINE_DIR: `/home/ana/${'very-long-folder-name/'.repeat(4)}` }, uid: 1000 };
  const p = paths.socketPath('pear-drops', deep);
  assert.match(p, /^[\\/]tmp[\\/]grapevine-1000-[0-9a-f]{8}[\\/]pear-drops\.sock$/);
  assert.ok(Buffer.byteLength(p) <= paths.MAX_SOCKET_PATH);
  const win = { platform: 'win32', env: { APPDATA: 'C:\\Users\\ana\\AppData\\Roaming' } };
  assert.match(paths.socketPath('stream-multiview', win), /^\\\\\.\\pipe\\grapevine-[0-9a-f]{8}-stream-multiview$/);
  const other = { platform: 'win32', env: { APPDATA: 'C:\\Users\\ben\\AppData\\Roaming' } };
  assert.notEqual(paths.socketPath('stream-multiview', win), paths.socketPath('stream-multiview', other), "another user's pipes are named differently");
  assert.throws(() => paths.socketPath('Bad Slug'), /valid app slug/);
});

test('listing finds every app with a socket, and ignores anything else', () => {
  const { place, cleanup } = tmpPlace();
  try {
    assert.deepEqual(paths.listSlugs(place), [], 'no folder yet');
    paths.ensureDir(place);
    const dir = paths.socketDir(place);
    for (const f of ['pear-drops.sock', 'stream-multiview.sock', 'notes.txt', 'Bad Name.sock']) fs.writeFileSync(path.join(dir, f), '');
    assert.deepEqual(paths.listSlugs(place).sort(), ['pear-drops', 'stream-multiview']);
  } finally {
    cleanup();
  }
  const fakeFs = { readdirSync: () => ['grapevine-00000000-x', `grapevine-${paths.tagOf('c:\\a')}-pear-drops`, 'other-pipe'] };
  assert.deepEqual(paths.listSlugs({ platform: 'win32', env: { GRAPEVINE_DIR: 'C:\\a' } }, fakeFs), ['pear-drops'], 'Windows: pipes with this folder’s tag');
});

test('the folder is private: made 0700, tightened if it was open, refused if it belongs to someone else', { skip: process.platform === 'win32' }, () => {
  const { place, cleanup } = tmpPlace();
  try {
    paths.ensureDir(place);
    const dir = paths.socketDir(place);
    assert.equal(fs.statSync(dir).mode & 0o777, 0o700);
    fs.chmodSync(dir, 0o755);
    paths.ensureDir(place);
    assert.equal(fs.statSync(dir).mode & 0o777, 0o700);
    assert.throws(() => paths.ensureDir({ ...place, uid: process.getuid() + 1 }), /belongs to another user/);
  } finally {
    cleanup();
  }
  assert.doesNotThrow(() => paths.ensureDir({ platform: 'win32' }), 'nothing to make for pipes');
});
