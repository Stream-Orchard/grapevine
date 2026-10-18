'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { check, Schemas } = require('../src/schema');
const { fixtures, all } = require('../fixtures');

const schemas = Schemas.load();
const none = () => {
  throw new Error('no refs here');
};

test('every example message passes its own version, and every bad one fails it', () => {
  const versions = all();
  assert.ok(versions.length >= 2, 'examples for drops.farming and players');
  for (const { capability, major } of versions) {
    const { valid, invalid } = fixtures(capability, major);
    assert.ok(valid.length && invalid.length, `${capability}@${major} has good and bad examples`);
    for (const f of valid) {
      const kind = f.event ? 'event' : 'result';
      assert.deepEqual(schemas.validate(capability, major, kind, f.event ?? f.result, f.params), [], `${capability}@${major} ${f.name}`);
    }
    for (const f of invalid)
      assert.notDeepEqual(schemas.validate(capability, major, f.event ? 'event' : 'result', f.event ?? f.result, f.params), [], `${f.name} fails`);
  }
  assert.deepEqual(fixtures('nothing', 1), { valid: [], invalid: [] });
});

test('the checker: types, lists, lengths, patterns, times, numbers and shapes', () => {
  assert.deepEqual(check(3, { type: 'integer' }, none), []);
  assert.deepEqual(check(3, { type: 'number' }, none), [], 'an integer is a number');
  assert.match(check(3.5, { type: 'integer' }, none)[0], /expected integer, got number/);
  assert.match(check(null, { type: ['string', 'boolean'] }, none)[0], /expected string or boolean, got null/);
  assert.match(check('c', { type: 'string', enum: ['a', 'b'] }, none)[0], /one of a, b/);
  assert.match(check('', { type: 'string', minLength: 1 }, none)[0], /shorter/);
  assert.match(check('abc', { type: 'string', maxLength: 2 }, none)[0], /longer/);
  assert.match(check('ABC', { type: 'string', pattern: '^[a-z]+$' }, none)[0], /doesn't match/);
  assert.deepEqual(check('2026-10-18T09:12:04+01:00', { type: 'string', format: 'date-time' }, none), []);
  assert.match(check(-1, { type: 'number', minimum: 0 }, none)[0], /below 0/);
  assert.match(check(9, { type: 'number', maximum: 5 }, none)[0], /above 5/);
  assert.match(check([1, 2, 3], { type: 'array', maxItems: 2 }, none)[0], /more than 2/);
  assert.deepEqual(check(['a', 1], { type: 'array', items: { type: 'string' } }, none), ['[1]: expected string, got integer']);
  assert.match(check(1, { anyOf: [{ type: 'string' }, { type: 'null' }] }, none)[0], /none of the allowed shapes/);
  const obj = { type: 'object', required: ['a'], properties: { a: { type: 'object', properties: { b: { type: 'string' } } } } };
  assert.deepEqual(check({ a: { b: 2 }, extra: true }, obj, none), ['a.b: expected string, got integer'], 'unknown fields are fine');
  assert.deepEqual(check({}, obj, none), ['a: missing']);
  assert.deepEqual(check({ x: { y: 1 } }, { type: 'object', additionalProperties: { type: 'string' } }, none), ['x: expected string, got object']);
});

test('schemas: references, the capability a name belongs to, and what is missing', () => {
  assert.equal(schemas.capabilityOf('drops.farming.changed'), 'drops.farming');
  assert.equal(schemas.capabilityOf('players.get'), 'players');
  assert.equal(schemas.capabilityOf('nothing.here'), null);
  assert.deepEqual(schemas.validate('nope', 1, 'event', 'nope.changed', {}), ['no schema for nope@1']);
  assert.deepEqual(schemas.validate('players', 1, 'event', 'players.gone', {}), ["players.gone isn't part of players@1"]);
  assert.deepEqual(schemas.validate('players', 1, 'params', 'players.get', {}), []);
  assert.throws(() => schemas.resolver({ defs: {} })('#Nope'), /Unknown schema reference/);
  assert.throws(() => schemas.add({ capability: 'x' }), /needs capability, major and minor/);
});

test('an app can add a capability of its own from a folder of schemas', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gv-schemas-'));
  fs.mkdirSync(path.join(dir, 'clips'));
  fs.writeFileSync(
    path.join(dir, 'clips', '1.json'),
    JSON.stringify({ capability: 'clips', major: 1, minor: 0, events: { 'clips.made': { type: 'object', required: ['url'] } } }),
  );
  fs.writeFileSync(path.join(dir, 'README.md'), 'not a folder');
  const s = Schemas.load([dir]);
  assert.equal(s.capabilityOf('clips.made'), 'clips');
  assert.deepEqual(s.validate('clips', 1, 'event', 'clips.made', {}), ['url: missing']);
  fs.rmSync(dir, { recursive: true, force: true });
});
