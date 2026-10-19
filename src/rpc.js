// JSON-RPC 2.0 bookkeeping for one connection: numbered requests waiting for their replies, and
// sorting what comes in into replies, requests and notifications (events).
'use strict';

const { CODES, GrapevineError } = require('./errors');

const REQUEST_TIMEOUT_MS = 10_000;

const isId = (id) => (typeof id === 'number' && Number.isFinite(id)) || typeof id === 'string';

class Rpc {
  /**
   * @param {(message: object) => void} send
   * @param {{ onRequest: (msg: {id: string | number, method: string, params: any}) => void, onNotification: (msg: {method: string, params: any}) => void }} handlers
   */
  constructor(send, { onRequest, onNotification }) {
    this.send = send;
    this.onRequest = onRequest;
    this.onNotification = onNotification;
    this.nextId = 1;
    /** @type {Map<string | number, {resolve: (v: any) => void, reject: (e: Error) => void, timer: NodeJS.Timeout}>} */
    this.pending = new Map();
    this.closed = false;
  }

  /** Sends a request; resolves with its result, or rejects with a GrapevineError. */
  request(method, params = {}, { timeout = REQUEST_TIMEOUT_MS } = {}) {
    if (this.closed) return Promise.reject(new GrapevineError(CODES.CLOSED, 'The connection is closed'));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new GrapevineError(CODES.TIMEOUT, `No reply to ${method} in ${timeout} ms`));
      }, timeout);
      timer.unref?.();
      this.pending.set(id, { resolve, reject, timer });
      this.send({ jsonrpc: '2.0', id, method, params });
    });
  }

  /** Sends a notification: an event, with no reply. */
  notify(method, params = {}) {
    if (!this.closed) this.send({ jsonrpc: '2.0', method, params });
  }

  reply(id, result) {
    if (!this.closed) this.send({ jsonrpc: '2.0', id, result: result ?? {} });
  }

  /** @param {string | number | null} id @param {InstanceType<typeof GrapevineError>} err */
  fail(id, err) {
    if (!this.closed) this.send({ jsonrpc: '2.0', id, error: err.toJSON() });
  }

  /** Sorts one incoming message. */
  handle(msg) {
    if (msg.jsonrpc !== '2.0') return this.fail(isId(msg.id) ? msg.id : null, new GrapevineError(CODES.INVALID_REQUEST, 'Not JSON-RPC 2.0'));
    if ('result' in msg || 'error' in msg) return this.settle(msg);
    if (typeof msg.method !== 'string' || !msg.method) return this.fail(isId(msg.id) ? msg.id : null, new GrapevineError(CODES.INVALID_REQUEST, 'No method'));
    const params = msg.params ?? {};
    if (typeof params !== 'object' || Array.isArray(params))
      return isId(msg.id) ? this.fail(msg.id, new GrapevineError(CODES.INVALID_PARAMS, 'params must be an object')) : undefined;
    if ('id' in msg) {
      if (!isId(msg.id)) return this.fail(null, new GrapevineError(CODES.INVALID_REQUEST, 'Bad id'));
      return this.onRequest({ id: msg.id, method: msg.method, params });
    }
    this.onNotification({ method: msg.method, params });
  }

  settle(msg) {
    const waiting = this.pending.get(msg.id);
    if (!waiting) return; // a reply to nothing (late, after a timeout): ignored
    this.pending.delete(msg.id);
    clearTimeout(waiting.timer);
    if ('error' in msg) {
      const e = msg.error ?? {};
      waiting.reject(new GrapevineError(Number.isInteger(e.code) ? e.code : CODES.INTERNAL_ERROR, String(e.message ?? 'Error'), e.data));
    } else waiting.resolve(msg.result);
  }

  /** Rejects everything still waiting. */
  close() {
    this.closed = true;
    for (const [, waiting] of this.pending) {
      clearTimeout(waiting.timer);
      waiting.reject(new GrapevineError(CODES.CLOSED, 'The connection closed'));
    }
    this.pending.clear();
  }
}

module.exports = { Rpc, REQUEST_TIMEOUT_MS };
