// Records that an app has shipped a release using Grapevine: each capability it provides or uses,
// at the version in schemas/ now, and the protocol. After that, test/released.test.js stops those
// versions changing in place, and the known-apps list can say "update <app> to <version>".
//   npm run released -- com.streamorchard.peardrops 0.1.6
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
 * @param {object} released the contents of released.json
 * @param {{id: string, provides: string[], uses: string[]}} app its known-apps entry
 * @param {string} version the app's release
 * @param {Record<string, any>} schemas from schemaFiles()
 * @param {number} protocol the protocol version it speaks
 */
function record(released, app, version, schemas, protocol) {
  const next = { ...released, schemas: { ...released.schemas }, firstRelease: { ...released.firstRelease } };
  const mine = { ...(next.firstRelease[app.id] ?? {}) };
  for (const cap of [...new Set([...app.provides, ...app.uses])]) {
    const files = Object.values(schemas).filter((s) => s.capability === cap);
    if (!files.length) throw new Error(`${app.id} lists ${cap}, which has no schema`);
    const latest = files.sort((a, b) => b.major - a.major)[0];
    next.schemas[`${cap}@${latest.major}`] = { minor: latest.minor, sha256: fingerprint(latest) };
    mine[`${cap}@${latest.major}.${latest.minor}`] ??= version; // the first release to have it stays
  }
  mine[`protocol@${protocol}`] ??= version;
  next.firstRelease[app.id] = mine;
  return next;
}

if (require.main === module) {
  const [id, version] = process.argv.slice(2);
  if (!id || !/^\d+\.\d+\.\d+/.test(version ?? '')) {
    process.stderr.write('Usage: npm run released -- <app id> <its release version, like 0.1.6>\n');
    process.exit(1);
  }
  const { KNOWN_APPS } = require('../src/known-apps');
  const app = KNOWN_APPS.find((a) => a.id === id);
  if (!app) {
    process.stderr.write(`${id} isn't in src/known-apps.js\n`);
    process.exit(1);
  }
  const { PROTOCOL } = require('../src/handshake');
  const next = record(JSON.parse(fs.readFileSync(FILE, 'utf8')), app, version, schemaFiles(), PROTOCOL.max);
  fs.writeFileSync(FILE, `${JSON.stringify(next, null, 2)}\n`);
  process.stdout.write(`Recorded ${app.name} ${version}: ${Object.keys(next.firstRelease[id]).join(', ')}\n`);
}

module.exports = { canonical, fingerprint, schemaFiles, record, FILE };
