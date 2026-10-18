// A capability version that has shipped in an app can't change in place: apps out there rely on it.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { canonical, fingerprint, schemaFiles, record, FILE } = require('../scripts/released');

const released = JSON.parse(fs.readFileSync(FILE, 'utf8'));

test('every released capability version is unchanged; additions go in a new minor', () => {
  const now = schemaFiles();
  for (const [key, was] of Object.entries(released.schemas)) {
    const schema = now[key];
    assert.ok(schema, `${key} has shipped in an app: its schema can't be removed`);
    assert.ok(schema.minor >= was.minor, `${key}: its minor went down`);
    if (schema.minor === was.minor) {
      assert.equal(
        fingerprint(schema),
        was.sha256,
        `${key}.${was.minor} has shipped in an app, so it can't change. Put the change in ${key.split('@')[1]}.${was.minor + 1} (raise "minor"), or a new major for a break. See PROTOCOL.md, "Versions".`,
      );
    }
  }
});

test('recording an app release: each capability it lists at its current version, and the first release stays', () => {
  const schemas = {
    'a@1': { capability: 'a', major: 1, minor: 2, x: 1 },
    'a@2': { capability: 'a', major: 2, minor: 0 },
    'b@1': { capability: 'b', major: 1, minor: 0 },
  };
  const app = { id: 'com.example.app', provides: ['a'], uses: ['b'] };
  const first = record({ schemas: {}, firstRelease: {} }, app, '1.0.0', schemas, 1);
  assert.deepEqual(Object.keys(first.schemas).sort(), ['a@2', 'b@1'], 'the newest major of each');
  assert.deepEqual(first.firstRelease['com.example.app'], { 'a@2.0': '1.0.0', 'b@1.0': '1.0.0', 'protocol@1': '1.0.0' });
  const again = record(first, app, '1.1.0', schemas, 1);
  assert.equal(again.firstRelease['com.example.app']['a@2.0'], '1.0.0', 'still the first release to have it');
  assert.throws(() => record(first, { ...app, uses: ['nope'] }, '1.2.0', schemas, 1), /lists nope, which has no schema/);
  assert.equal(canonical({ b: [1, { d: 2, c: 3 }], a: 'x' }), canonical({ a: 'x', b: [1, { c: 3, d: 2 }] }), 'key order and spacing make no difference');
});

test('the known-apps list takes each app’s first releases from the record', () => {
  const { KNOWN_APPS } = require('../src/known-apps');
  for (const app of KNOWN_APPS) assert.deepEqual(app.firstRelease, released.firstRelease[app.id] ?? {});
});
