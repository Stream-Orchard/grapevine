// Shared test helpers: a private folder per test, the two known apps, fast timings, and a raw
// client that speaks the wire format directly (for what a well-behaved link would never send).
'use strict';

const fs = require('fs');
const os = require('os');
const net = require('net');
const path = require('path');
const { createLink, paths } = require('../src');
const { LineReader, encode } = require('../src/framing');

const PD = { id: 'com.streamorchard.peardrops', slug: 'pear-drops', name: 'Pear Drops', version: '0.1.5' };
const MV = { id: 'com.glowingpear.streammultiview', slug: 'stream-multiview', name: 'Stream Multiview', version: '0.4.0' };

const FAST = { pollMs: 40, backoffMs: [20, 40, 80], handshakeMs: 800, pingMs: 300, pongMs: 150 };

/** A folder of its own, and a cleanup that removes it (and its /tmp fallback, if long paths used one). */
function tmpPlace() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gv-'));
  const place = { env: { GRAPEVINE_DIR: dir } };
  return {
    dir,
    place,
    cleanup() {
      for (const d of new Set([dir, paths.socketDir(place)])) fs.rmSync(d, { recursive: true, force: true });
    },
  };
}

/** Pear Drops and Stream Multiview links in one folder, both switched on unless told otherwise. */
function pair(place, { pd = {}, mv = {} } = {}) {
  const make = (app, provides, uses, o) =>
    createLink({ provides, uses, allowed: () => true, place, strict: true, timing: FAST, ...o, app: { ...app, ...o.app } });
  return {
    pd: make(PD, { 'drops.farming': '1.0' }, { players: '1.0' }, pd),
    mv: make(MV, { players: '1.0' }, { 'drops.farming': '1.0' }, mv),
  };
}

/** Resolves when `emitter` emits `event` (with its arguments), or fails after `ms`. */
function once(emitter, event, ms = 4000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`Timed out waiting for ${event}`)), ms);
    emitter.once(event, (...args) => {
      clearTimeout(t);
      resolve(args);
    });
  });
}

/** Polls until fn() is truthy, or fails after `ms`. */
async function until(fn, what = 'a condition', ms = 4000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 15));
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** A plain socket to an app, sending and reading raw lines. */
async function raw(socketPath) {
  const socket = net.createConnection(socketPath);
  await once(socket, 'connect');
  const inbox = [];
  const waiting = [];
  let closed = false;
  const reader = new LineReader(
    (m) => (waiting.length ? waiting.shift()(m) : inbox.push(m)),
    () => {},
  );
  socket.on('data', (d) => reader.push(d));
  socket.on('close', () => {
    closed = true;
    for (const w of waiting.splice(0)) w(null);
  });
  socket.on('error', () => {});
  return {
    socket,
    send: (m) => socket.write(typeof m === 'string' ? m : encode(m)),
    /** The next message, or null once the connection closes. */
    next: (ms = 3000) =>
      inbox.length
        ? Promise.resolve(inbox.shift())
        : closed
          ? Promise.resolve(null)
          : new Promise((resolve, reject) => {
              const t = setTimeout(() => reject(new Error('No message')), ms);
              waiting.push((m) => {
                clearTimeout(t);
                resolve(m);
              });
            }),
    closed: () => closed,
    close: () => socket.destroy(),
  };
}

module.exports = { PD, MV, FAST, tmpPlace, pair, once, until, sleep, raw };
