#!/usr/bin/env node
// Run in an app's repo (npx grapevine-check): lists the capability versions the app's releases
// have shipped that Grapevine hasn't recorded yet, with the command that records them (Grapevine's
// app-shipped skill). Until they're recorded, those versions can still be changed in place, and
// other apps can't say which release to update to.
//
// The app says what it speaks in its package.json, so every release tag has it:
//   "grapevine": { "app": "com.streamorchard.peardrops", "provides": { "drops.farming": "1.0" }, "uses": { "players": "1.0" } }
//
//   npx grapevine-check            prints what needs recording (exit 0)
//   npx grapevine-check --strict   exits 1 when something does
//   npx grapevine-check --offline  uses the record in the installed package, not GitHub's
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const RECORD_URL = 'https://raw.githubusercontent.com/Stream-Orchard/grapevine/main/schemas/released.json';
const INSTALLED = path.join(__dirname, '..', 'schemas', 'released.json');
const VERSION = /^v?(\d+)\.(\d+)\.(\d+)$/;

/** "capability@major.minor" for each capability a package.json's grapevine field provides or uses. */
function declaredBy(grapevine) {
  const out = new Set();
  for (const list of [grapevine?.provides, grapevine?.uses]) {
    for (const [cap, versions] of Object.entries(list ?? {})) for (const v of [].concat(versions)) out.add(`${cap}@${v}`);
  }
  return [...out].sort();
}

const byVersion = (a, b) => {
  const [x, y] = [VERSION.exec(a.version), VERSION.exec(b.version)];
  for (let i = 1; i <= 3; i++) if (Number(x[i]) !== Number(y[i])) return Number(x[i]) - Number(y[i]);
  return 0;
};

/**
 * What hasn't been recorded: for each capability version any release declared, the first release
 * that did, unless the record already has it.
 * @param {{version: string, grapevine: any}[]} releases every release tag, with its package.json's grapevine field (or none)
 * @param {{firstRelease: Record<string, Record<string, string>>}} released Grapevine's record
 * @returns {{app: string, version: string, capabilities: string[], command: string}[]} one per release to record, oldest first
 */
function findUnrecorded(releases, released) {
  const first = new Map(); // "app capability@version" -> the first release with it
  for (const r of [...releases].filter((x) => VERSION.test(x.version)).sort(byVersion)) {
    if (!r.grapevine?.app) continue;
    for (const cap of declaredBy(r.grapevine)) {
      const key = `${r.grapevine.app} ${cap}`;
      if (!first.has(key)) first.set(key, { app: r.grapevine.app, version: r.version.replace(/^v/, ''), cap });
    }
  }
  const todo = new Map(); // "app version" -> capabilities
  for (const { app, version, cap } of first.values()) {
    if (released?.firstRelease?.[app]?.[cap]) continue;
    const key = `${app} ${version}`;
    todo.set(key, { app, version, capabilities: [...(todo.get(key)?.capabilities ?? []), cap] });
  }
  return [...todo.values()]
    .sort((a, b) => byVersion(a, b))
    .map((t) => ({ ...t, command: `npm run released -- ${t.app} ${t.version} ${t.capabilities.join(' ')}` }));
}

const git = (cwd, args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });

/** Every v* tag in the repo, with its package.json's grapevine field. */
function releasesIn(cwd) {
  const tags = git(cwd, ['tag', '-l', 'v*'])
    .split('\n')
    .map((t) => t.trim())
    .filter((t) => VERSION.test(t));
  return tags.map((tag) => {
    let grapevine = null;
    try {
      grapevine = JSON.parse(git(cwd, ['show', `${tag}:package.json`])).grapevine ?? null;
    } catch {}
    return { version: tag, grapevine };
  });
}

/** Grapevine's record: GitHub's copy (the newest), or the installed package's when offline or it can't be fetched. */
async function loadRecord({ offline = false, fetchImpl = globalThis.fetch, installed = INSTALLED } = {}) {
  if (!offline && fetchImpl) {
    try {
      const res = await fetchImpl(RECORD_URL, { signal: AbortSignal.timeout(5000) });
      if (res.ok) return { record: await res.json(), source: 'GitHub' };
    } catch {}
  }
  return { record: JSON.parse(fs.readFileSync(installed, 'utf8')), source: 'the installed package (it may be behind GitHub)' };
}

/**
 * @param {string[]} argv
 * @param {{cwd?: string, out?: (text: string) => void, fetchImpl?: typeof fetch}} [opts]
 */
async function main(argv, { cwd = process.cwd(), out = (t) => void process.stdout.write(t), fetchImpl = globalThis.fetch } = {}) {
  const strict = argv.includes('--strict');
  const offline = argv.includes('--offline');
  try {
    if (!offline) git(cwd, ['fetch', '--tags', '--quiet']);
  } catch {} // no remote, or offline: the tags already here
  const releases = releasesIn(cwd);
  if (!releases.some((r) => r.grapevine?.app)) {
    out('No release of this app declares Grapevine capabilities yet (package.json "grapevine"). Nothing to record.\n');
    return 0;
  }
  const { record, source } = await loadRecord({ offline, fetchImpl });
  const todo = findUnrecorded(releases, record);
  if (!todo.length) {
    out(`Every capability version this app has released is recorded in Grapevine (checked against ${source}).\n`);
    return 0;
  }
  out(`Grapevine hasn't recorded what these releases shipped (checked against ${source}):\n`);
  for (const t of todo) out(`  ${t.version}: ${t.capabilities.join(', ')}\n`);
  out(`Record them in a Grapevine checkout (its app-shipped skill), then a pull request and a patch release:\n`);
  for (const t of todo) out(`  ${t.command}\n`);
  return strict ? 1 : 0;
}

if (require.main === module) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      process.stderr.write(`grapevine-check: ${err.message}\n`);
      process.exit(2);
    },
  );
}

module.exports = { declaredBy, findUnrecorded, releasesIn, loadRecord, main, RECORD_URL };
