'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const hs = require('../src/handshake');
const { PD } = require('./helpers');

test('versions are "major.minor"; lists take one or several', () => {
  assert.deepEqual(hs.parseVersion('2.11'), { major: 2, minor: 11 });
  assert.equal(hs.parseVersion('2'), null);
  assert.equal(hs.parseVersion(2), null);
  assert.deepEqual(hs.normalizeList({ a: '1.0', b: ['1.2', '2.0'] }), { a: ['1.0'], b: ['1.2', '2.0'] });
  assert.deepEqual(hs.normalizeList(), {});
  assert.throws(() => hs.normalizeList({ a: 'one' }), /major\.minor/);
  assert.throws(() => hs.normalizeList({ a: [] }), /major\.minor/);
  assert.deepEqual(hs.helloCapabilities({ a: ['1.0'] }, { a: ['1.0'], b: ['2.0'] }), { a: { provides: ['1.0'], uses: ['1.0'] }, b: { uses: ['2.0'] } });
});

test('each capability gets the highest major both apps have; what neither can agree is listed', () => {
  const mine = { provides: { 'drops.farming': ['1.3', '2.0'], spare: ['1.0'] }, uses: { players: ['1.0', '2.0'], clips: ['1.0'] } };
  const theirs = {
    'drops.farming': { uses: ['1.0'] },
    players: { provides: ['2.4'] },
    clips: { provides: ['3.0'] },
    spare: { uses: ['4.0'] },
  };
  const a = hs.agree(mine, theirs);
  assert.deepEqual(Object.fromEntries(a.incoming), { players: { major: 2, minor: 4 } });
  assert.deepEqual(Object.fromEntries(a.outgoing), { 'drops.farming': { major: 1, minor: 3 } });
  assert.deepEqual(a.missing, [
    { capability: 'clips', direction: 'incoming', mine: [1], theirs: [3] },
    { capability: 'spare', direction: 'outgoing', mine: [1], theirs: [4] },
  ]);
  assert.deepEqual(hs.agree({ provides: {}, uses: { x: ['1.0'] } }, undefined).missing, [{ capability: 'x', direction: 'incoming', mine: [1], theirs: [] }]);
  assert.equal(hs.agreeProtocol({ min: 1, max: 3 }, { min: 2, max: 5 }), 3);
  assert.equal(hs.agreeProtocol({ min: 1, max: 1 }, { min: 2, max: 2 }), null);
});

test('a proof shows an app knows the key: only the same key, role and nonce match', () => {
  const key = hs.newKey();
  const n = hs.nonce();
  const p = hs.proof(key, 'server', n);
  assert.ok(hs.proofOk(key, 'server', n, p));
  assert.ok(!hs.proofOk(key, 'client', n, p), 'roles differ, so a proof can’t be sent back');
  assert.ok(!hs.proofOk(hs.newKey(), 'server', n, p));
  assert.ok(!hs.proofOk(key, 'server', hs.nonce(), p));
  assert.ok(!hs.proofOk(key, 'server', n, 'short'));
  assert.ok(!hs.proofOk(key, 'server', n, undefined));
  assert.equal(Buffer.from(key, 'base64').length, 32);
});

test('a hello is checked field by field', () => {
  const good = {
    protocol: { min: 1, max: 1 },
    app: { ...PD, homepage: 'https://x.y', icon: 'data:image/png;base64,AA' },
    capabilities: {},
    auth: { nonce: hs.nonce(), pair: true },
  };
  assert.deepEqual(hs.checkHello(good), []);
  assert.deepEqual(hs.checkApp(null), ['app: missing']);
  const bad = hs.checkHello({
    protocol: { min: 2, max: 1 },
    app: { id: 'X', slug: 'Bad', name: '', version: '', summary: 's'.repeat(301), icon: 'http://x', homepage: 'http://insecure', download: 1 },
    capabilities: [],
    auth: { nonce: 'short', pair: 'yes' },
  });
  for (const field of [
    'app.id',
    'app.slug',
    'app.name',
    'app.version',
    'app.summary',
    'app.icon',
    'app.homepage',
    'app.download',
    'protocol',
    'capabilities',
    'auth.nonce',
    'auth.pair',
  ]) {
    assert.ok(
      bad.some((p) => p.startsWith(field)),
      `${field} is reported`,
    );
  }
  assert.ok(hs.checkHello({}).includes('auth.nonce: 32 random bytes, base64'));
});
