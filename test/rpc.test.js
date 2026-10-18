'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Rpc } = require('../src/rpc');
const { CODES, GrapevineError } = require('../src/errors');

const make = () => {
  const sent = [];
  const requests = [];
  const notes = [];
  const rpc = new Rpc((m) => sent.push(m), { onRequest: (m) => requests.push(m), onNotification: (m) => notes.push(m) });
  return { rpc, sent, requests, notes };
};

test('a request resolves with its reply, or rejects with its error', async () => {
  const { rpc, sent } = make();
  const a = rpc.request('x.get', { q: 1 });
  const b = rpc.request('x.get');
  assert.deepEqual(sent[0], { jsonrpc: '2.0', id: 1, method: 'x.get', params: { q: 1 } });
  rpc.handle({ jsonrpc: '2.0', id: 2, error: { code: CODES.NOT_AGREED, message: 'no', data: { why: 1 } } });
  rpc.handle({ jsonrpc: '2.0', id: 1, result: { ok: true } });
  rpc.handle({ jsonrpc: '2.0', id: 99, result: {} }); // a reply to nothing is ignored
  assert.deepEqual(await a, { ok: true });
  await assert.rejects(b, (e) => e instanceof GrapevineError && e.code === CODES.NOT_AGREED && e.data.why === 1);
  const c = rpc.request('x.get');
  rpc.handle({ jsonrpc: '2.0', id: 3, error: {} });
  await assert.rejects(c, (e) => e.code === CODES.INTERNAL_ERROR && e.message === 'Error', 'a malformed error still rejects');
});

test('a request with no reply times out; closing rejects what is still waiting', async () => {
  const { rpc } = make();
  // A request's timer doesn't keep the process alive (in an app, its socket does). Here nothing
  // else would, and Node 22's test runner would end the file while it waits.
  const alive = setInterval(() => {}, 1000);
  await assert.rejects(rpc.request('x.slow', {}, { timeout: 20 }), (e) => e.code === CODES.TIMEOUT);
  clearInterval(alive);
  const waiting = rpc.request('x.get');
  rpc.close();
  await assert.rejects(waiting, (e) => e.code === CODES.CLOSED);
  await assert.rejects(rpc.request('x.get'), (e) => e.code === CODES.CLOSED);
  const before = make();
  before.rpc.close();
  before.rpc.notify('x.e');
  before.rpc.reply(1, {});
  before.rpc.fail(1, new GrapevineError(1, 'x'));
  assert.deepEqual(before.sent, [], 'nothing is sent once closed');
});

test('incoming messages are sorted into requests and events; bad ones get the standard errors', () => {
  const { rpc, sent, requests, notes } = make();
  rpc.handle({ jsonrpc: '2.0', id: 'a', method: 'x.get' });
  rpc.handle({ jsonrpc: '2.0', method: 'x.changed', params: { v: 1 } });
  assert.deepEqual(requests, [{ id: 'a', method: 'x.get', params: {} }]);
  assert.deepEqual(notes, [{ method: 'x.changed', params: { v: 1 } }]);
  rpc.handle({ id: 5, method: 'x' });
  rpc.handle({ jsonrpc: '2.0', id: 6 });
  rpc.handle({ jsonrpc: '2.0', id: 7, method: 'x', params: [1] });
  rpc.handle({ jsonrpc: '2.0', method: 'x', params: 'nope' }); // a bad event: dropped, no reply
  rpc.handle({ jsonrpc: '2.0', id: { no: 1 }, method: 'x' });
  assert.deepEqual(
    sent.map((m) => [m.id, m.error.code]),
    [
      [5, CODES.INVALID_REQUEST],
      [6, CODES.INVALID_REQUEST],
      [7, CODES.INVALID_PARAMS],
      [null, CODES.INVALID_REQUEST],
    ],
  );
  rpc.reply('a');
  assert.deepEqual(sent.at(-1), { jsonrpc: '2.0', id: 'a', result: {} });
});

test('a GrapevineError turns into a JSON-RPC error, with its data only if it has some', () => {
  assert.deepEqual(new GrapevineError(-1, 'm').toJSON(), { code: -1, message: 'm' });
  assert.deepEqual(new GrapevineError(-1, 'm', { a: 1 }).toJSON(), { code: -1, message: 'm', data: { a: 1 } });
});
