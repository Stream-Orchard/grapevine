// JSON-RPC 2.0's error codes, and the ones Grapevine adds (PROTOCOL.md, "Errors").
'use strict';

const CODES = Object.freeze({
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
  NOT_PAIRED: -32001, // not paired yet, or the proof was wrong
  NOT_AGREED: -32002, // the capability wasn't agreed on this connection
  UNSUPPORTED: -32003, // no version both apps support
  TOO_MANY: -32004, // too many messages
  SWITCHED_OFF: -32005, // the app's switch for the other app is off
  CLOSED: -32099, // the connection closed before the reply came (local only, never sent)
  TIMEOUT: -32098, // no reply in time (local only, never sent)
});

/** An error with a JSON-RPC code, thrown by request() and by handlers that want a specific code. */
class GrapevineError extends Error {
  /**
   * @param {number} code
   * @param {string} message
   * @param {unknown} [data]
   */
  constructor(code, message, data) {
    super(message);
    this.name = 'GrapevineError';
    this.code = code;
    this.data = data;
  }

  /** The `error` member of a JSON-RPC reply. */
  toJSON() {
    return this.data === undefined ? { code: this.code, message: this.message } : { code: this.code, message: this.message, data: this.data };
  }
}

module.exports = { CODES, GrapevineError };
