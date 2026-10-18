#!/usr/bin/env node
// A stand-in for another app, for an app's own tests: it speaks Grapevine as that app (any version,
// any capabilities) without the real app installed.
//
// In a test:
//   const { standInPeer } = require('@streamorchard/grapevine/stand-in-peer');
//   const peer = await standInPeer({ as: 'com.glowingpear.streammultiview', dir, uses: { 'drops.farming': '1.0' } });
//   peer.link.on('event', (from, name, params) => …);   peer.link.publish('players.changed', {…});
//
// From the command line (a launch test can spawn it): it prints one JSON line per thing that
// happens ({"type":"connected"|"event"|"disconnected", …}) and reads lines on stdin:
//   {"publish":"players.changed","data":{…}}   {"request":"drops.farming.get","params":{},"to":"<app id>"}
//   node stand-in-peer.js --as com.glowingpear.streammultiview --dir /tmp/x --uses drops.farming@1.0 --provides players@1.0
'use strict';

const readline = require('readline');
const { createLink, KNOWN_APPS, memoryKeyStore } = require('./src');

/**
 * @param {object} o
 * @param {string} o.as the known app to pretend to be (its id)
 * @param {string} o.dir a GRAPEVINE_DIR shared with the app under test
 * @param {string} [o.version] its version (default 99.0.0)
 * @param {Record<string, string | string[]>} [o.provides]
 * @param {Record<string, string | string[]>} [o.uses]
 * @param {(appId: string) => boolean} [o.allowed] its switch (default: on for every app)
 * @param {object} [o.timing]
 * @param {import('./src/keys').KeyStore} [o.keys]
 */
async function standInPeer({ as, dir, version = '99.0.0', provides = {}, uses = {}, allowed = () => true, timing, keys = memoryKeyStore() }) {
  const known = KNOWN_APPS.find((a) => a.id === as);
  if (!known) throw new Error(`stand-in-peer: ${as} isn't a known app`);
  const link = createLink({
    app: {
      id: known.id,
      slug: known.slug,
      name: `${known.name} (stand-in)`,
      version,
      summary: known.summary,
      homepage: known.homepage,
      download: known.download,
    },
    provides,
    uses,
    allowed,
    keys,
    place: { env: { ...process.env, GRAPEVINE_DIR: dir } },
    timing,
    strict: false,
  });
  await link.start();
  return { link, stop: () => link.stop() };
}

/** "drops.farming@1.0,players@1.0" -> { 'drops.farming': '1.0', players: '1.0' } */
function parseCaps(text) {
  /** @type {Record<string, string[]>} */
  const out = {};
  for (const part of String(text ?? '')
    .split(',')
    .filter(Boolean)) {
    const [cap, v] = part.split('@');
    (out[cap] ??= []).push(v || '1.0');
  }
  return out;
}

async function main(argv) {
  const arg = (name) => {
    const i = argv.indexOf(`--${name}`);
    return i === -1 ? undefined : argv[i + 1];
  };
  const out = (o) => process.stdout.write(`${JSON.stringify(o)}\n`);
  const { link } = await standInPeer({
    as: arg('as'),
    dir: arg('dir') ?? process.env.GRAPEVINE_DIR,
    version: arg('version'),
    provides: parseCaps(arg('provides')),
    uses: parseCaps(arg('uses')),
  });
  link.on('connected', (id) => out({ type: 'connected', app: id }));
  link.on('disconnected', (id, reason) => out({ type: 'disconnected', app: id, reason }));
  link.on('event', (from, name, params) => out({ type: 'event', from, name, params }));
  out({ type: 'started' });
  readline.createInterface({ input: process.stdin }).on('line', async (line) => {
    try {
      const cmd = JSON.parse(line);
      if (cmd.publish) out({ type: 'published', params: link.publish(cmd.publish, cmd.data ?? {}) });
      if (cmd.request) out({ type: 'result', method: cmd.request, result: await link.request(cmd.to, cmd.request, cmd.params ?? {}) });
      if (cmd.quit) {
        await link.stop();
        process.exit(0);
      }
    } catch (err) {
      out({ type: 'error', message: err.message, code: err.code });
    }
  });
  const quit = () => link.stop().then(() => process.exit(0));
  process.on('SIGTERM', quit);
  process.on('SIGINT', quit);
}

if (require.main === module)
  main(process.argv.slice(2)).catch((err) => {
    process.stderr.write(`${err.stack}\n`);
    process.exit(1);
  });

module.exports = { standInPeer, parseCaps };
