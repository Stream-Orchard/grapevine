'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const readline = require('readline');
const { spawn } = require('child_process');
const { standInPeer, parseCaps } = require('../stand-in-peer');
const { tmpPlace, pair, once, until, PD, MV } = require('./helpers');

test('parseCaps reads "cap@version,…"', () => {
  assert.deepEqual(parseCaps('drops.farming@1.0,players,players@2.0'), { 'drops.farming': ['1.0'], players: ['1.0', '2.0'] });
  assert.deepEqual(parseCaps(undefined), {});
});

test('a stand-in for a known app connects to the app under test', async () => {
  const { dir, place, cleanup } = tmpPlace();
  const { pd } = pair(place);
  try {
    await pd.start();
    const peer = await standInPeer({ as: MV.id, dir, uses: { 'drops.farming': '1.0' }, provides: { players: '1.0' }, timing: { pollMs: 40 } });
    await until(() => pd.isConnected(MV.id), 'the stand-in to connect');
    assert.equal(pd.peers()[0].version, '99.0.0');
    const got = once(peer.link, 'event');
    pd.publish('drops.farming.changed', { state: 'waiting', account: null, channel: null, drop: null });
    assert.equal((await got)[2].state, 'waiting');
    await peer.stop();
    await assert.rejects(standInPeer({ as: 'com.nobody', dir }), /isn't a known app/);
  } finally {
    await pd.stop();
    cleanup();
  }
});

test('from the command line: one JSON line per thing that happens, and commands on stdin', async () => {
  const { dir, place, cleanup } = tmpPlace();
  const { pd } = pair(place);
  const child = spawn(
    process.execPath,
    [path.join(__dirname, '..', 'stand-in-peer.js'), '--as', MV.id, '--dir', dir, '--uses', 'drops.farming@1.0', '--provides', 'players@1.0'],
    { stdio: ['pipe', 'pipe', 'inherit'] },
  );
  const lines = [];
  readline.createInterface({ input: child.stdout }).on('line', (l) => lines.push(JSON.parse(l)));
  const seen = (type) => until(() => lines.find((l) => l.type === type), `a "${type}" line`, 8000);
  try {
    await pd.start();
    await seen('started');
    await seen('connected');
    pd.publish('drops.farming.changed', { state: 'farming', account: null, channel: { platform: 'kick', slug: 'pixelpear' }, drop: null });
    assert.equal((await seen('event')).params.channel.slug, 'pixelpear');
    const heard = once(pd, 'event');
    child.stdin.write(`${JSON.stringify({ publish: 'players.changed', data: { platforms: {} } })}\n`);
    assert.equal((await heard)[1], 'players.changed');
    child.stdin.write(`${JSON.stringify({ request: 'drops.farming.get', to: PD.id })}\n`);
    assert.equal((await seen('result')).result.state, 'farming');
    child.stdin.write('not json\n');
    await seen('error');
    child.stdin.write(`${JSON.stringify({ quit: true })}\n`);
    await once(child, 'exit', 8000);
  } finally {
    child.kill();
    await pd.stop();
    cleanup();
  }
});
