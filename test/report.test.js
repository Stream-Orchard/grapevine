'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { compatibility, incompatible, whoUpdates } = require('../src/report');
const { KNOWN_APPS } = require('../src/known-apps');
const { PD, MV } = require('./helpers');

test('works when nothing is missing', () => {
  assert.deepEqual(compatibility(PD, MV, { missing: [] }), { state: 'works', missing: [], text: 'Works' });
});

test('a missing feature names the app with the older versions, and the release to update to when it is known', (t) => {
  const pd = KNOWN_APPS.find((a) => a.id === PD.id);
  t.after(() => delete pd.firstRelease['players@2.0']);
  pd.firstRelease['players@2.0'] = '0.1.7';
  const r = compatibility(MV, PD, {
    missing: [
      { capability: 'players', direction: 'outgoing', mine: [2], theirs: [1] },
      { capability: 'clips', direction: 'incoming', mine: [1], theirs: [] },
    ],
  });
  assert.equal(r.state, 'limited');
  assert.deepEqual(r.missing[0].update, { app: 'Pear Drops', appId: PD.id, version: '0.1.7' });
  assert.equal(r.text, 'Works, with a feature missing: update Pear Drops to 0.1.7 or later (and 1 more)');
  // The other way round: this app is the older one.
  assert.equal(whoUpdates(PD, MV, [1], [3], 'players@').app, 'Pear Drops');
  assert.equal(
    compatibility(PD, MV, { missing: [{ capability: 'x', direction: 'incoming', mine: [1], theirs: [3] }] }).text,
    'Works, with a feature missing: update Pear Drops',
  );
});

test("can't connect: no protocol version in common", () => {
  const r = incompatible(PD, MV, { min: 2, max: 2 }, { min: 1, max: 1 });
  assert.equal(r.state, 'incompatible');
  assert.equal(r.text, "Can't connect: update Stream Multiview");
  const mv = KNOWN_APPS.find((a) => a.id === MV.id);
  mv.firstRelease['protocol@2'] = '0.6.0';
  assert.equal(incompatible(PD, MV, { min: 2, max: 2 }, { min: 1, max: 1 }).text, "Can't connect: update Stream Multiview to 0.6.0 or later");
  delete mv.firstRelease['protocol@2'];
});
