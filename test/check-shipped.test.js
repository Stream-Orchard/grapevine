// grapevine-check, run in an app's repo: which released capability versions Grapevine hasn't recorded.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { declaredBy, findUnrecorded, loadRecord, main, RECORD_URL } = require('../scripts/check-shipped');

const PD = 'com.streamorchard.peardrops';
const gv = (provides, uses) => ({ app: PD, provides, uses });

test('what a package.json says it speaks', () => {
  assert.deepEqual(declaredBy(gv({ 'drops.farming': '1.0' }, { players: ['1.0', '2.0'] })), ['drops.farming@1.0', 'players@1.0', 'players@2.0']);
  assert.deepEqual(declaredBy(null), []);
});

test('each capability version is due from the first release that shipped it, until the record has it', () => {
  const releases = [
    { version: 'v0.1.7', grapevine: gv({ 'drops.farming': '1.1' }, { players: '1.0' }) },
    { version: 'v0.1.4', grapevine: null }, // before Grapevine
    { version: 'v0.1.6', grapevine: gv({ 'drops.farming': '1.0' }, { players: '1.0' }) },
    { version: 'nightly', grapevine: gv({ x: '9.0' }, {}) }, // not a release tag
  ];
  assert.deepEqual(findUnrecorded(releases, { firstRelease: {} }), [
    { app: PD, version: '0.1.6', capabilities: ['drops.farming@1.0', 'players@1.0'], command: `npm run released -- ${PD} 0.1.6 drops.farming@1.0 players@1.0` },
    { app: PD, version: '0.1.7', capabilities: ['drops.farming@1.1'], command: `npm run released -- ${PD} 0.1.7 drops.farming@1.1` },
  ]);
  const recorded = { firstRelease: { [PD]: { 'drops.farming@1.0': '0.1.6', 'players@1.0': '0.1.6' } } };
  assert.deepEqual(
    findUnrecorded(releases, recorded).map((t) => t.version),
    ['0.1.7'],
  );
  assert.deepEqual(findUnrecorded(releases, { firstRelease: { [PD]: { ...recorded.firstRelease[PD], 'drops.farming@1.1': '0.1.7' } } }), []);
  assert.deepEqual(
    findUnrecorded(
      [
        { version: 'v0.1.10', grapevine: gv({ a: '1.0' }, {}) },
        { version: 'v0.1.9', grapevine: gv({ a: '1.0' }, {}) },
      ],
      {},
    ),
    [{ app: PD, version: '0.1.9', capabilities: ['a@1.0'], command: `npm run released -- ${PD} 0.1.9 a@1.0` }],
    'versions sort as numbers: 0.1.9 before 0.1.10',
  );
});

test('the record comes from GitHub, or the installed copy when that fails or when offline', async () => {
  const online = await loadRecord({ fetchImpl: async (url) => ({ ok: url === RECORD_URL, json: async () => ({ firstRelease: { x: {} } }) }) });
  assert.equal(online.source, 'GitHub');
  assert.deepEqual(online.record.firstRelease, { x: {} });
  const failing = await loadRecord({
    fetchImpl: async () => {
      throw new Error('offline');
    },
  });
  assert.match(failing.source, /installed package/);
  assert.ok(failing.record.firstRelease);
  assert.match((await loadRecord({ fetchImpl: async () => ({ ok: false }) })).source, /installed package/);
  assert.match((await loadRecord({ offline: true })).source, /installed package/);
});

test('in a real repo: release tags with and without the grapevine field', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gv-app-'));
  const git = (...args) =>
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', '-c', 'tag.gpgsign=false', ...args], {
      cwd: dir,
      stdio: 'ignore',
    });
  const release = (version, pkg) => {
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'app', version, ...pkg }));
    git('add', '-A');
    git('commit', '-qm', version, '--no-verify');
    git('tag', `v${version}`);
  };
  try {
    git('init', '-q');
    release('0.1.0', {});
    const lines = [];
    const out = (t) => lines.push(t);
    assert.equal(await main(['--offline'], { cwd: dir, out }), 0);
    assert.match(lines.join(''), /No release of this app declares Grapevine capabilities yet/);

    release('0.1.1', { grapevine: gv({ 'drops.farming': '1.0' }, { players: '1.0' }) });
    lines.length = 0;
    const none = { fetchImpl: async () => ({ ok: true, json: async () => ({ firstRelease: {} }) }) };
    assert.equal(await main([], { cwd: dir, out, ...none }), 0);
    assert.match(lines.join(''), /checked against GitHub/);
    assert.match(lines.join(''), new RegExp(`npm run released -- ${PD.replace(/\./g, '\\.')} 0\\.1\\.1 drops\\.farming@1\\.0 players@1\\.0`));
    assert.equal(await main(['--strict'], { cwd: dir, out, ...none }), 1, '--strict fails while something is due');

    lines.length = 0;
    const done = {
      fetchImpl: async () => ({ ok: true, json: async () => ({ firstRelease: { [PD]: { 'drops.farming@1.0': '0.1.1', 'players@1.0': '0.1.1' } } }) }),
    };
    assert.equal(await main(['--strict'], { cwd: dir, out, ...done }), 0);
    assert.match(lines.join(''), /Every capability version this app has released is recorded/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
