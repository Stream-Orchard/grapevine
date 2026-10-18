'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const paths = require('../src/paths');
const { tmpPlace } = require('./helpers');

/** A file system in memory, for Windows' pipe secret on any OS: files, and the pipes `\\.\pipe\` lists. */
function memFs(pipes = []) {
  const files = new Map();
  return {
    files,
    pipes,
    mkdirSync() {},
    readFileSync(f) {
      if (!files.has(f)) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      return files.get(f);
    },
    writeFileSync(f, data, opts = {}) {
      if (opts.flag === 'wx' && files.has(f)) throw Object.assign(new Error('EEXIST'), { code: 'EEXIST' });
      files.set(f, String(data));
    },
    readdirSync: () => pipes,
  };
}

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
  const fsAna = memFs();
  assert.match(paths.socketPath('stream-multiview', win, fsAna), /^\\\\\.\\pipe\\grapevine-[0-9a-f]{16}-stream-multiview$/);
  assert.equal(paths.socketPath('stream-multiview', win, fsAna), paths.socketPath('stream-multiview', win, fsAna), 'the same every time');
  const other = { platform: 'win32', env: { APPDATA: 'C:\\Users\\ben\\AppData\\Roaming' } };
  assert.notEqual(
    paths.socketPath('stream-multiview', win, fsAna),
    paths.socketPath('stream-multiview', other, memFs()),
    "another user's pipes are named differently",
  );
  assert.notEqual(
    paths.socketPath('stream-multiview', win, fsAna),
    paths.socketPath('stream-multiview', win, memFs()),
    "and can't be worked out from the folder alone: it takes the secret only that user can read",
  );
  assert.match(paths.legacyPipe('stream-multiview', win), /^\\\\\.\\pipe\\grapevine-[0-9a-f]{8}-stream-multiview$/, 'the older name');
  assert.throws(() => paths.socketPath('Bad Slug'), /valid app slug/);
  assert.throws(() => paths.legacyPipe('Bad Slug', win), /valid app slug/);
});

test(
  'listing finds every app with a socket, and ignores anything else',
  { skip: process.platform === 'win32' && 'Windows lists pipes, not a folder (the next test)' },
  () => {
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
  },
);

test('on Windows, listing finds the pipes with this user’s tag, and the older names; reaching one picks the name it has', () => {
  const place = { platform: 'win32', env: { GRAPEVINE_DIR: 'C:\\a' } };
  const fakeFs = memFs();
  const tag = paths.pipeTag(place, fakeFs);
  fakeFs.pipes.push(
    'grapevine-00000000-x',
    `grapevine-${tag}-pear-drops`,
    `grapevine-${paths.tagOf('c:\\a')}-stream-multiview`,
    `grapevine-${tag}-Bad Name`,
    'other-pipe',
  );
  assert.deepEqual(paths.listSlugs(place, fakeFs).sort(), ['pear-drops', 'stream-multiview']);
  assert.equal(paths.findSocket('pear-drops', place, fakeFs), paths.socketPath('pear-drops', place, fakeFs), 'its pipe');
  assert.equal(paths.findSocket('stream-multiview', place, fakeFs), paths.legacyPipe('stream-multiview', place), 'only the older name: that one');
  assert.equal(paths.findSocket('not-running', place, fakeFs), paths.socketPath('not-running', place, fakeFs));
  fakeFs.pipes.push(`grapevine-${tag}-stream-multiview`);
  assert.equal(paths.findSocket('stream-multiview', place, fakeFs), paths.socketPath('stream-multiview', place, fakeFs), 'both: the current one');
  const broken = {
    ...memFs(),
    readdirSync: () => {
      throw new Error('no pipes');
    },
  };
  assert.equal(paths.findSocket('pear-drops', place, broken), paths.socketPath('pear-drops', place, broken));
  assert.equal(paths.findSocket('pear-drops', { platform: 'linux', env: { GRAPEVINE_DIR: '/tmp/x' } }), path.join('/tmp/x', 'pear-drops.sock'));
});

test('the Windows pipe secret: made once, kept, shared by apps that start at the same moment, replaced if it was spoilt', () => {
  const place = { platform: 'win32', env: { GRAPEVINE_DIR: 'C:\\a' } };
  const file = path.join('C:\\a', 'pipe-secret');
  const f = memFs();
  const s = paths.pipeSecret(place, f);
  assert.match(s, /^[0-9a-f]{32}$/);
  assert.equal(paths.pipeSecret(place, f), s, 'kept');
  // another app wrote it between this one reading and writing
  const race = memFs();
  let reads = 0;
  const readFileSync = race.readFileSync;
  race.readFileSync = (p) => (reads++ === 0 ? readFileSync(p) : (race.files.set(file, 'a'.repeat(32)), readFileSync(p)));
  race.writeFileSync = (p, d, o = {}) => {
    if (o.flag === 'wx') throw Object.assign(new Error('EEXIST'), { code: 'EEXIST' });
    race.files.set(p, d);
  };
  assert.equal(paths.pipeSecret(place, race), 'a'.repeat(32), 'theirs');
  const spoilt = memFs();
  spoilt.files.set(file, 'not a secret');
  assert.match(paths.pipeSecret(place, spoilt), /^[0-9a-f]{32}$/);
  assert.notEqual(spoilt.files.get(file), 'not a secret', 'replaced');
  const readOnly = {
    ...memFs(),
    writeFileSync: () => {
      throw Object.assign(new Error('EACCES'), { code: 'EACCES' });
    },
  };
  assert.throws(() => paths.pipeSecret(place, readOnly), /EACCES/);
  const made = memFs();
  paths.ensureDir(place, made);
  assert.match(made.files.get(file), /^[0-9a-f]{32}$/, 'starting a link makes it');
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
    // a link where the folder should be (in /tmp, another user could have made it first)
    const link = path.join(path.dirname(dir), `${path.basename(dir)}-link`);
    fs.symlinkSync(dir, link);
    const lfs = { ...fs, mkdirSync() {}, lstatSync: () => fs.lstatSync(link) };
    assert.throws(() => paths.ensureDir(place, lfs), /isn't a folder/);
    fs.rmSync(link);
  } finally {
    cleanup();
  }
});
