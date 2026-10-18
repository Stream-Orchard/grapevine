// Example messages for every capability version, good and bad. Each app's tests run them, so an
// app that says it supports a version is checked against that version's own examples.
//   const { fixtures } = require('@streamorchard/grapevine/fixtures');
//   for (const f of fixtures('drops.farming', 1).valid) …
'use strict';

const fs = require('fs');
const path = require('path');

/**
 * @typedef {{name: string, event?: string, result?: string, note?: string, params: any}} Fixture
 * @returns {{valid: Fixture[], invalid: Fixture[]}}
 */
function fixtures(capability, major) {
  const dir = path.join(__dirname, capability, String(major));
  const read = (kind) => {
    const folder = path.join(dir, kind);
    if (!fs.existsSync(folder)) return [];
    return fs
      .readdirSync(folder)
      .filter((f) => f.endsWith('.json'))
      .sort()
      .map((f) => ({ name: f.slice(0, -5), ...JSON.parse(fs.readFileSync(path.join(folder, f), 'utf8')) }));
  };
  return { valid: read('valid'), invalid: read('invalid') };
}

/** Every capability@major there are examples for. */
function all() {
  return fs
    .readdirSync(__dirname)
    .filter((d) => fs.statSync(path.join(__dirname, d)).isDirectory())
    .flatMap((cap) => fs.readdirSync(path.join(__dirname, cap)).map((m) => ({ capability: cap, major: Number(m) })));
}

module.exports = { fixtures, all };
