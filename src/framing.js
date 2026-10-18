// A socket carries bytes, not messages: each message is one line of JSON ending in "\n".
'use strict';

const { StringDecoder } = require('string_decoder');

const MAX_LINE = 1024 * 1024; // bytes; a longer line closes the connection

/** Turns a message into its line. */
function encode(message) {
  return `${JSON.stringify(message)}\n`;
}

/**
 * Collects bytes into lines and parses each one. `onMessage(object)` gets every JSON object,
 * `onBad(reason)` anything else: 'parse' (not JSON), 'not-object' (an array, number, …) or
 * 'too-long' (over the limit, after which the reader stops).
 */
class LineReader {
  /**
   * @param {(message: Record<string, unknown>) => void} onMessage
   * @param {(reason: 'parse' | 'not-object' | 'too-long') => void} onBad
   * @param {number} [max]
   */
  constructor(onMessage, onBad, max = MAX_LINE) {
    this.onMessage = onMessage;
    this.onBad = onBad;
    this.max = max;
    this.buffer = '';
    this.done = false;
    this.decoder = new StringDecoder('utf8'); // a character split across two chunks stays whole
  }

  /** @param {Buffer | string} chunk */
  push(chunk) {
    if (this.done) return;
    this.buffer += typeof chunk === 'string' ? chunk : this.decoder.write(chunk);
    for (let at = this.buffer.indexOf('\n'); at !== -1; at = this.buffer.indexOf('\n')) {
      const line = this.buffer.slice(0, at);
      this.buffer = this.buffer.slice(at + 1);
      if (Buffer.byteLength(line) > this.max) return this.stop();
      if (line.trim()) this.parse(line);
      if (this.done) return;
    }
    if (Buffer.byteLength(this.buffer) > this.max) this.stop();
  }

  parse(line) {
    let value;
    try {
      value = JSON.parse(line);
    } catch {
      return this.onBad('parse');
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) return this.onBad('not-object');
    this.onMessage(value);
  }

  stop() {
    this.done = true;
    this.buffer = '';
    this.onBad('too-long');
  }
}

module.exports = { MAX_LINE, encode, LineReader };
