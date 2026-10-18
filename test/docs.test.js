// The docs keep up with the schemas: PROTOCOL.md (what another implementation follows) and the
// README name every capability, event, method and field.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { schemaFiles } = require('../scripts/released');

const ROOT = path.join(__dirname, '..');
const PROTOCOL = fs.readFileSync(path.join(ROOT, 'PROTOCOL.md'), 'utf8');
const README = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
const COMMON = JSON.parse(fs.readFileSync(path.join(ROOT, 'schemas', 'common.json'), 'utf8')).defs;

/** Every property name in a schema, however deep. */
function fields(schema, out = new Set()) {
  if (!schema || typeof schema !== 'object') return out;
  for (const [k, v] of Object.entries(schema.properties ?? {})) {
    out.add(k);
    fields(v, out);
  }
  for (const s of [schema.items, schema.additionalProperties, ...(schema.anyOf ?? [])]) fields(s, out);
  return out;
}

/** Whether the doc names it inside backticks: `name`, `drop.name` or `{ name, … }`. */
const named = (doc, name) => new RegExp(`\`[^\`\\n]*\\b${name.replace(/\./g, '\\.')}\\b[^\`\\n]*\``).test(doc);

test('PROTOCOL.md has a section for every capability version, naming its events, methods and fields', () => {
  for (const s of Object.values(schemaFiles())) {
    assert.ok(PROTOCOL.includes(`### \`${s.capability}\` ${s.major}.${s.minor}`), `PROTOCOL.md: a "### \`${s.capability}\` ${s.major}.${s.minor}" section`);
    for (const name of [...Object.keys(s.events ?? {}), ...Object.keys(s.methods ?? {})]) assert.ok(named(PROTOCOL, name), `PROTOCOL.md names ${name}`);
    const all = new Set();
    for (const def of Object.values(s.defs ?? {})) fields(def, all);
    for (const m of Object.values(s.methods ?? {})) fields(m.result, all);
    for (const f of all) assert.ok(named(PROTOCOL, f), `PROTOCOL.md names ${s.capability}'s field "${f}"`);
  }
});

test('PROTOCOL.md describes every shared type and its fields', () => {
  for (const [name, def] of Object.entries(COMMON)) {
    if (name === 'Empty') continue;
    assert.ok(named(PROTOCOL, name), `PROTOCOL.md names the shared type ${name}`);
    for (const f of fields(def)) assert.ok(named(PROTOCOL, f), `PROTOCOL.md names ${name}'s field "${f}"`);
  }
});

test('the README lists every capability, and every known app is in it', () => {
  for (const s of Object.values(schemaFiles()))
    assert.ok(README.includes(`\`${s.capability}\` ${s.major}.${s.minor}`), `README: ${s.capability} ${s.major}.${s.minor} in Capabilities`);
  for (const app of require('../src/known-apps').KNOWN_APPS) assert.ok(README.includes(app.name), `README mentions ${app.name}`);
});
