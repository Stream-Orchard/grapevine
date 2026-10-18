'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { LineReader, encode, MAX_LINE } = require('../src/framing');

const collect = (max) => {
  const got = [];
  const bad = [];
  const r = new LineReader(
    (m) => got.push(m),
    (why) => bad.push(why),
    max,
  );
  return { r, got, bad };
};

test('each message is one line of JSON, however the bytes arrive', () => {
  assert.equal(encode({ a: 1 }), '{"a":1}\n');
  const { r, got } = collect();
  const text = encode({ a: 1 }) + encode({ b: 'é ✓' });
  for (const ch of Buffer.from(text)) r.push(Buffer.from([ch])); // one byte at a time
  r.push('\n\n'); // blank lines are skipped
  assert.deepEqual(got, [{ a: 1 }, { b: 'é ✓' }]);
});

test('not JSON, or not an object, is reported and the reader carries on', () => {
  const { r, got, bad } = collect();
  r.push('nope\n[1,2]\n42\n{"ok":true}\n');
  assert.deepEqual(bad, ['parse', 'not-object', 'not-object']);
  assert.deepEqual(got, [{ ok: true }]);
});

test('a line over the limit stops the reader, whether or not it has ended yet', () => {
  const a = collect(16);
  a.r.push(`${'x'.repeat(20)}\n{"a":1}\n`);
  assert.deepEqual(a.bad, ['too-long']);
  assert.deepEqual(a.got, []);
  a.r.push('{"b":1}\n');
  assert.deepEqual(a.got, [], 'stopped for good');

  const b = collect(16);
  b.r.push('x'.repeat(17)); // no newline yet
  assert.deepEqual(b.bad, ['too-long']);
  assert.equal(MAX_LINE, 1024 * 1024);
});

test("each message comes with its line's size in bytes, the newline included", () => {
  const sizes = [];
  const r = new LineReader(
    (_m, bytes) => sizes.push(bytes),
    () => {},
  );
  r.push(encode({ a: 1 }) + encode({ b: 'é ✓' }));
  assert.deepEqual(sizes, [8, Buffer.byteLength('{"b":"é ✓"}\n')]);
  assert.equal(sizes[1], 15, 'bytes, not characters');
});
