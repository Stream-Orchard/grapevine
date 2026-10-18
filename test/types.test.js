'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { generate, toType, prefixOf } = require('../scripts/types');

test('types/capabilities.d.ts matches the schemas', () => {
  assert.equal(fs.readFileSync(path.join(__dirname, '..', 'types', 'capabilities.d.ts'), 'utf8'), generate(), 'run `npm run types`');
});

test('schemas become TypeScript types', () => {
  assert.equal(prefixOf('drops.farming', 2), 'DropsFarmingV2');
  assert.equal(toType({ type: 'string', enum: ['a', 'b'] }, ''), '"a" | "b"');
  assert.equal(toType({ type: 'string', 'x-open': ['a'] }, ''), '"a" | (string & {})');
  assert.equal(toType({ type: ['string', 'null'] }, ''), 'string | null');
  assert.equal(toType({ type: 'array', items: { type: 'boolean' } }, ''), 'Array<boolean>');
  assert.equal(toType({ type: 'object' }, ''), 'Record<string, unknown>');
  assert.equal(toType({ $ref: '#State' }, 'PlayersV1'), 'PlayersV1State');
  assert.equal(toType({ $ref: 'common:Channel' }, 'X'), 'Channel');
  assert.equal(toType({}, ''), 'unknown');
  assert.equal(toType({ type: 'object', properties: { 'a-b': { type: 'integer' } } }, ''), '{\n  "a-b"?: number;\n}');
});
