// Records that an app has shipped a release using Grapevine: each capability it provides or uses,
// at the version in schemas/ now, and the protocol. After that, test/released.test.js stops those
// versions changing in place, and the known-apps list can say "update <app> to <version>".
//   npm run released -- com.streamorchard.peardrops 0.1.6 drops.farming@1.0 players@1.0
// (the versions are what the release declared; `npm run grapevine:check` in the app's repo prints the line)
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const FILE = path.join(ROOT, 'schemas', 'released.json');

/** The same JSON always gives the same text, whatever its key order or spacing. */
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

const fingerprint = (schema) => crypto.createHash('sha256').update(canonical(schema)).digest('hex');

/** Every schema file: "capability@major" -> its contents. */
function schemaFiles(dir = path.join(ROOT, 'schemas')) {
  const out = {};
  for (const cap of fs.readdirSync(dir).filter((d) => fs.statSync(path.join(dir, d)).isDirectory())) {
    for (const f of fs.readdirSync(path.join(dir, cap)).filter((x) => /^\d+\.json$/.test(x))) {
      const s = JSON.parse(fs.readFileSync(path.join(dir, cap, f), 'utf8'));
      out[`${s.capability}@${s.major}`] = s;
    }
  }
  return out;
}

/**
 * @param {Record<string, any>} released the contents of released.json
 * @param {{id: string, provides: string[], uses: string[]}} app its known-apps entry
 * @param {string} version the app's release
 * @param {Record<string, any>} schemas from schemaFiles()
 * @param {number} protocol the protocol version it speaks
 * @param {string[]} [declared] what the release declared, like ['drops.farming@1.0'] (from grapevine-check).
 *   Without it, each capability the known-apps list gives the app, at its newest version here.
 */
function record(released, app, version, schemas, protocol, declared) {
  const next = { ...released, schemas: { ...released.schemas }, firstRelease: { ...released.firstRelease } };
  const mine = { ...(next.firstRelease[app.id] ?? {}) };
  const wanted = declared?.length
    ? declared
    : [...new Set([...app.provides, ...app.uses])].map((cap) => {
        const files = Object.values(schemas).filter((s) => s.capability === cap);
        if (!files.length) throw new Error(`${app.id} lists ${cap}, which has no schema`);
        const latest = files.sort((a, b) => b.major - a.major)[0];
        return `${cap}@${latest.major}.${latest.minor}`;
      });
  for (const entry of wanted) {
    const m = /^(.+)@(\d+)\.(\d+)$/.exec(entry);
    if (!m) throw new Error(`"${entry}" isn't capability@major.minor`);
    const [, cap, major, minor] = [m[0], m[1], Number(m[2]), Number(m[3])];
    const file = schemas[`${cap}@${major}`];
    if (!file) throw new Error(`${app.id} lists ${cap}, which has no schema for ${major}`);
    if (file.minor < minor) throw new Error(`${entry}: Grapevine only has ${cap} ${major}.${file.minor}`);
    // The schema as it is now is that version only if no later minor has been added since.
    const was = next.schemas[`${cap}@${major}`];
    if (file.minor === minor && !(was && was.minor > minor)) next.schemas[`${cap}@${major}`] = { minor, sha256: fingerprint(file) };
    mine[`${cap}@${major}.${minor}`] ??= version; // the first release to have it stays
  }
  mine[`protocol@${protocol}`] ??= version;
  next.firstRelease[app.id] = mine;
  return next;
}

if (require.main === module) {
  const [id, version, ...declared] = process.argv.slice(2);
  if (!id || !/^\d+\.\d+\.\d+/.test(version ?? '')) {
    process.stderr.write('Usage: npm run released -- <app id> <its release version, like 0.1.6> [capability@major.minor …, as grapevine-check prints]\n');
    process.exit(1);
  }
  const { KNOWN_APPS } = require('../src/known-apps');
  const app = KNOWN_APPS.find((a) => a.id === id);
  if (!app) {
    process.stderr.write(`${id} isn't in src/known-apps.js\n`);
    process.exit(1);
  }
  const { PROTOCOL } = require('../src/handshake');
  const next = record(JSON.parse(fs.readFileSync(FILE, 'utf8')), app, version, schemaFiles(), PROTOCOL.max, declared);
  fs.writeFileSync(FILE, `${JSON.stringify(next, null, 2)}\n`);
  process.stdout.write(`Recorded ${app.name} ${version}: ${Object.keys(next.firstRelease[id]).join(', ')}\n`);
}

module.exports = { canonical, fingerprint, schemaFiles, record, FILE };
