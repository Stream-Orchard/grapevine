// One connection to another app, from the hello to the end: pairing and proofs, then requests and
// events for the capabilities both apps agreed on, a ping to notice a hung app, and a message limit.
'use strict';

const { EventEmitter } = require('events');
const { LineReader, encode } = require('./framing');
const { Rpc, REQUEST_TIMEOUT_MS } = require('./rpc');
const { CODES, GrapevineError } = require('./errors');
const hs = require('./handshake');

const TIMING = Object.freeze({
  handshakeMs: 3000, // the hello and the proofs must be done by then
  pingMs: 20_000, // the connecting app pings this often
  pongMs: 10_000, // and closes if there's no answer in this long
  rateMax: 50, // messages a second
  strikes: 3, // over the limit this many times in a minute closes the connection
});

// For the activity log: requests waiting for a reply are forgotten after this long, or past this many.
const INFLIGHT_MS = REQUEST_TIMEOUT_MS;
const INFLIGHT_MAX = 1000;
// Their messages carry nonces, proofs and pairing keys, so the activity log leaves their data out.
const SECRET = new Set(['link.hello', 'link.auth']);
// Before the other app has proved the pairing, anything could be on the other end: the activity log gets no
// data from it, and only these method names (anything else is just "a message").
const LINK_METHODS = new Set(['link.hello', 'link.auth', 'link.bye', 'link.ping']);
// Bigger data than this goes in the activity log as `truncated: true` instead (a line can be 1 MiB).
const LOG_DATA_MAX = 16 * 1024;
// Messages that come while finishing the proofs wait, up to this many.
const QUEUE_MAX = 100;

/**
 * One message for the activity log (Link's 'message' event).
 * @typedef {object} Message
 * @property {number} at
 * @property {string | null} app
 * @property {'out' | 'in'} dir
 * @property {'request' | 'reply' | 'error' | 'event'} kind
 * @property {string | null} method
 * @property {string | number | null} [id]
 * @property {number} [ms]
 * @property {number} bytes
 * @property {any} [data]
 * @property {boolean} [truncated] its data was too big for the log, so it's left out
 */

/**
 * What a connection needs from the link that owns it.
 * @typedef {object} Host
 * @property {object} self this app's description (the hello's "app")
 * @property {{provides: Record<string, string[]>, uses: Record<string, string[]>}} mine
 * @property {{get(id: string): {key: string, pairedAt?: string} | null, set(id: string, key: string): void, delete(id: string): void}} keys
 * @property {(ids: string[]) => boolean} allowed whether this app's switch for that app (under any of its ids) is on
 * @property {(id: string) => string[]} idsOf a known app's id and former ids
 * @property {(app: {id: string, slug: string, formerIds?: string[]}) => {id: string, ids: string[]}} resolve
 *   the id this app knows another app by (its known-apps entry, matched by any id), and every id it has had
 * @property {(ids: string[]) => {key: string, pairedAt?: string} | null} findKey the pairing key, filed under any of those ids
 * @property {(ids: string[]) => boolean} [mayPair] whether a new pairing with that app may be kept now (confirmPairing)
 * @property {(id: string) => void} [paired] a new pairing was kept
 * @property {import('./schema').Schemas} schemas
 * @property {(conn: Connection, method: string, params: any) => Promise<any>} call runs a capability method
 * @property {(conn: Connection, events: string[]) => string[]} subscribe
 * @property {(conn: Connection) => void} [afterSubscribe] sends the latest state to a new subscriber
 * @property {(level: string, text: string) => void} log
 * @property {() => boolean} [watching] whether anything listens for the activity log; nothing is built for it otherwise
 * @property {(conn: Connection, message: Message) => void} [message] one message sent or received, for the activity log
 * @property {typeof TIMING} timing
 */

class Connection extends EventEmitter {
  /**
   * @param {import('net').Socket} socket
   * @param {Host} host
   * @param {{initiator: boolean, expectedId?: string}} role
   */
  constructor(socket, host, { initiator, expectedId }) {
    super();
    this.socket = socket;
    this.host = host;
    this.initiator = initiator;
    this.expectedId = expectedId ?? null;
    this.state = 'hello'; // hello -> auth -> ready -> closed (the connecting app: hello -> authing -> ready)
    this.peer = null; // the other app's description, from its hello
    this.peerId = null; // the id this app knows the other one by
    /** @type {string[]} */
    this.peerIds = []; // and every id it has had
    this.agreed = { incoming: new Map(), outgoing: new Map(), missing: [] };
    this.protocol = null;
    this.subscribed = new Set(); // events the other app subscribed to
    this.queue = []; // messages that came while finishing the proofs
    this.rate = { windowStart: Date.now(), count: 0, strikes: [] };
    this.lastHeard = Date.now();
    this.closeReason = null;
    // Requests waiting for a reply, by id, for the activity log: ones this app sent, and ones it was sent.
    /** @type {{out: Map<any, {method: string, at: number}>, in: Map<any, {method: string, at: number}>}} */
    this.inflight = { out: new Map(), in: new Map() };

    this.rpc = new Rpc((m) => this.send(m), {
      onRequest: (m) => this.onRequest(m),
      onNotification: (m) => this.onNotification(m),
    });
    this.reader = new LineReader(
      (m, bytes) => this.onMessage(m, bytes),
      (why) => {
        if (why === 'too-long') this.close('A message was too long');
        else
          this.rpc.fail(
            null,
            new GrapevineError(why === 'parse' ? CODES.PARSE_ERROR : CODES.INVALID_REQUEST, why === 'parse' ? 'Not JSON' : 'Not a JSON object'),
          );
      },
    );
    socket.on('data', (d) => this.reader.push(d));
    socket.on('error', (/** @type {NodeJS.ErrnoException} */ e) => this.close(`Socket error: ${e.code ?? e.message}`));
    socket.on('close', () => this.close('The other app closed the connection'));
    this.handshakeTimer = setTimeout(() => this.close('The hello took too long'), host.timing.handshakeMs);
    this.handshakeTimer.unref?.();
  }

  send(message) {
    if (this.state === 'closed' || this.socket.destroyed) return;
    const line = encode(message);
    this.socket.write(line);
    if (this.host.watching?.()) this.report('out', message, Buffer.byteLength(line));
  }

  // ------------------------------------------------------------------ the activity log

  /** Tells the link about one message sent or received, for its 'message' event. */
  report(dir, m, bytes) {
    if (this.state === 'closed') return;
    if (dir === 'in' && this.state !== 'ready' && this.state !== 'authing') return this.reportUnproven(m, bytes);
    const at = Date.now();
    const isId = typeof m.id === 'number' || typeof m.id === 'string';
    /** @type {Message} */
    let entry;
    if ('result' in m || 'error' in m) {
      // A reply answers a request that went the other way.
      const asked = isId ? this.inflight[dir === 'out' ? 'in' : 'out'] : null;
      const req = asked?.get(m.id);
      asked?.delete(m.id);
      const method = req?.method ?? null;
      const failed = 'error' in m;
      entry = { at, app: this.peerApp(), dir, kind: failed ? 'error' : 'reply', method, id: m.id ?? null, bytes };
      if (req) entry.ms = at - req.at;
      // An unknown reply before the connection is ready could be the hello's: no data either.
      if (!SECRET.has(method) && (method !== null || this.state === 'ready')) {
        const e = m.error ?? {};
        entry.data = failed ? { code: e.code, message: e.message } : m.result;
      }
    } else if (typeof m.method === 'string') {
      const request = 'id' in m;
      entry = { at, app: this.peerApp(), dir, kind: request ? 'request' : 'event', method: m.method, ...(request ? { id: m.id } : {}), bytes };
      if (request && isId) this.remember(this.inflight[dir], m.id, m.method, at);
      if (!SECRET.has(m.method)) entry.data = m.params ?? {};
    } else return; // not JSON-RPC at all
    if ('data' in entry && bytes > LOG_DATA_MAX) {
      delete entry.data;
      entry.truncated = true;
    }
    this.host.message?.(this, entry);
  }

  /**
   * A message received before the other app has proved the pairing: what it is and its size, nothing from
   * inside it. A reply to this app's own hello still says it's the hello's.
   */
  reportUnproven(m, bytes) {
    const at = Date.now();
    const reply = 'result' in m || 'error' in m;
    if (!reply && typeof m.method !== 'string') return;
    /** @type {Message} */
    const entry = {
      at,
      app: this.peerApp(),
      dir: 'in',
      kind: reply ? ('error' in m ? 'error' : 'reply') : 'id' in m ? 'request' : 'event',
      method: null,
      bytes,
    };
    if (reply) {
      const req = typeof m.id === 'number' || typeof m.id === 'string' ? this.inflight.out.get(m.id) : undefined;
      if (req) {
        this.inflight.out.delete(m.id);
        entry.method = req.method;
        entry.id = m.id;
        entry.ms = at - req.at;
      }
    } else if (LINK_METHODS.has(m.method)) {
      entry.method = m.method;
      if ('id' in m) {
        entry.id = m.id;
        if (typeof m.id === 'number' || typeof m.id === 'string') this.remember(this.inflight.in, m.id, m.method, at); // for its reply
      }
    }
    this.host.message?.(this, entry);
  }

  /** The other app's id as this app knows it, or null until its hello says. */
  peerApp() {
    return this.peerId ?? this.expectedId ?? null;
  }

  /** Remembers a request, forgetting ones too old to be answered (or past the cap). */
  remember(map, id, method, at) {
    map.delete(id); // a reused id goes to the end
    map.set(id, { method, at });
    for (const [oldId, r] of map) {
      if (map.size <= INFLIGHT_MAX && at - r.at <= INFLIGHT_MS) break;
      map.delete(oldId);
    }
  }

  // ------------------------------------------------------------------ the connecting app

  /** Says hello, checks the reply's proof, proves itself, and is ready. */
  async start() {
    const { self, mine, keys } = this.host;
    // The key may be filed under a former id of that app: one it had before a rename.
    const expectedIds = this.host.idsOf(this.expectedId);
    const stored = this.host.findKey(expectedIds);
    const clientNonce = hs.nonce();
    let res;
    try {
      res = await this.rpc.request(
        'link.hello',
        { protocol: hs.PROTOCOL, app: self, capabilities: hs.helloCapabilities(mine.provides, mine.uses), auth: { nonce: clientNonce, pair: !stored } },
        { timeout: this.host.timing.handshakeMs },
      );
    } catch (err) {
      return this.refused(err);
    }
    const problems = hs.checkApp(res?.app);
    if (problems.length) return this.close(`Its hello reply isn't valid: ${problems.join('; ')}`);
    const theirIds = [res.app.id, ...(res.app.formerIds ?? [])];
    if (!theirIds.some((i) => expectedIds.includes(i))) return this.close(`Expected ${this.expectedId}, but ${res.app.id} answered`);
    if (hs.agreeProtocol(hs.PROTOCOL, { min: res.protocol, max: res.protocol }) === null)
      return this.close(`It chose protocol ${res.protocol}, which this app doesn't speak`);
    const key = stored?.key ?? res.auth?.key;
    if (typeof key !== 'string' || Buffer.from(key, 'base64').length !== 32) return this.close('No pairing key');
    if (!hs.proofOk(key, 'server', clientNonce, res.auth?.proof)) {
      this.emit('status', { status: 'pair-again', keyHeldBy: stored ? 'us' : 'them' });
      return this.close("Its proof was wrong: the pairing doesn't match");
    }
    if (!stored && this.host.mayPair && !this.host.mayPair(expectedIds)) {
      // A first pairing waits for this app's user to allow it: nothing is kept on either side yet.
      this.emit('status', { status: 'confirm', peer: res.app });
      return this.close('Waiting for you to allow the pairing');
    }
    this.peer = res.app;
    this.peerId = this.expectedId; // the id this app knows it by, whatever it calls itself now
    this.peerIds = [...new Set([...expectedIds, ...theirIds])];
    this.protocol = res.protocol;
    this.agreed = hs.agree(mine, res.capabilities);
    this.state = 'authing';
    try {
      await this.rpc.request('link.auth', { proof: hs.proof(key, 'client', res.auth.nonce) }, { timeout: this.host.timing.handshakeMs });
    } catch (err) {
      return this.refused(err);
    }
    if (!stored) {
      keys.set(this.peerId, key);
      this.host.paired?.(this.peerId);
    }
    this.ready();
    for (const m of this.queue.splice(0)) this.dispatch(m);
  }

  refused(err) {
    if (err.code === CODES.NOT_PAIRED && err.data?.reason === 'pair-again') {
      this.emit('status', { status: 'pair-again', keyHeldBy: err.data.keyHeldBy === 'listener' ? 'them' : 'us' });
    } else if (err.code === CODES.NOT_PAIRED && err.data?.reason === 'confirm') this.emit('status', { status: 'waiting', reason: 'confirm-there' });
    else if (err.code === CODES.SWITCHED_OFF) this.emit('status', { status: 'waiting', reason: 'switched-off' });
    else if (err.code === CODES.UNSUPPORTED) this.emit('status', { status: 'incompatible', theirProtocol: err.data?.protocol ?? null });
    this.close(`Refused: ${err.message}`);
  }

  // ------------------------------------------------------------------ the listening app

  handleHello(id, params) {
    const problems = hs.checkHello(params);
    if (problems.length) return this.reject(id, new GrapevineError(CODES.INVALID_PARAMS, 'Invalid hello', { problems }));
    const protocol = hs.agreeProtocol(hs.PROTOCOL, params.protocol);
    if (protocol === null) {
      this.emit('status', { status: 'incompatible', peer: params.app, theirProtocol: params.protocol });
      return this.reject(id, new GrapevineError(CODES.UNSUPPORTED, 'No protocol version in common', { protocol: hs.PROTOCOL }));
    }
    const { id: peerId, ids } = this.host.resolve(params.app);
    if (!this.host.allowed(ids))
      return this.reject(id, new GrapevineError(CODES.SWITCHED_OFF, `${this.host.self.name} isn't set to connect with ${params.app.name}`));
    const stored = this.host.findKey(ids);
    let key;
    if (params.auth.pair) {
      // An app asking to pair while this one still has a key: only once you press Pair again here.
      if (stored) {
        this.emit('status', { status: 'pair-again', peer: params.app, keyHeldBy: 'us' });
        return this.reject(id, new GrapevineError(CODES.NOT_PAIRED, 'Already paired with a different key', { reason: 'pair-again', keyHeldBy: 'listener' }));
      }
      if (this.host.mayPair && !this.host.mayPair(ids)) {
        // A first pairing waits for this app's user to allow it.
        this.emit('status', { status: 'confirm', peer: params.app });
        return this.reject(
          id,
          new GrapevineError(CODES.NOT_PAIRED, `${this.host.self.name} is waiting for its user to allow the pairing`, { reason: 'confirm' }),
        );
      }
      key = hs.newKey();
    } else {
      if (!stored) {
        this.emit('status', { status: 'pair-again', peer: params.app, keyHeldBy: 'them' });
        return this.reject(id, new GrapevineError(CODES.NOT_PAIRED, 'Not paired', { reason: 'pair-again', keyHeldBy: 'connector' }));
      }
      key = stored.key;
    }
    const serverNonce = hs.nonce();
    this.pending = { key, serverNonce, pairing: !!params.auth.pair };
    this.peer = params.app;
    this.peerId = peerId;
    this.peerIds = ids;
    this.protocol = protocol;
    this.agreed = hs.agree(this.host.mine, params.capabilities);
    this.state = 'auth';
    const agreed = {};
    for (const [cap, v] of [...this.agreed.incoming, ...this.agreed.outgoing]) agreed[cap] = String(v.major);
    this.rpc.reply(id, {
      protocol,
      app: this.host.self,
      capabilities: hs.helloCapabilities(this.host.mine.provides, this.host.mine.uses),
      agreed,
      auth: { proof: hs.proof(key, 'server', params.auth.nonce), nonce: serverNonce, ...(this.pending.pairing ? { key } : {}) },
    });
  }

  handleAuth(id, params) {
    const { key, serverNonce, pairing } = this.pending;
    if (!hs.proofOk(key, 'client', serverNonce, params.proof)) {
      this.emit('status', { status: 'pair-again', peer: this.peer, keyHeldBy: 'them' });
      return this.reject(id, new GrapevineError(CODES.NOT_PAIRED, 'Wrong proof', { reason: 'pair-again', keyHeldBy: 'connector' }));
    }
    if (pairing) {
      this.host.keys.set(this.peerId, key);
      this.host.paired?.(this.peerId);
    }
    this.pending = null;
    this.rpc.reply(id, {});
    this.ready();
  }

  /** Refuses a request, then closes. */
  reject(id, err) {
    this.rpc.fail(id, err);
    this.close(err.message);
  }

  // ------------------------------------------------------------------ ready

  ready() {
    clearTimeout(this.handshakeTimer);
    this.state = 'ready';
    this.host.log('info', `Connected to ${this.peer.name} ${this.peer.version}`);
    if (this.initiator) {
      this.pingTimer = setInterval(() => {
        this.rpc.request('link.ping', {}, { timeout: this.host.timing.pongMs }).catch((err) => {
          if (err.code === CODES.TIMEOUT) this.close('The other app stopped answering');
        });
      }, this.host.timing.pingMs);
    } else {
      // The listening app hears a ping at least every pingMs; three missed means it's hung.
      this.pingTimer = setInterval(() => {
        if (Date.now() - this.lastHeard > this.host.timing.pingMs * 3) this.close('The other app stopped answering');
      }, this.host.timing.pingMs);
    }
    this.pingTimer.unref?.();
    this.emit('ready');
    // Every event of every capability this app uses from the other one.
    const events = [];
    for (const [cap, { major }] of this.agreed.incoming) events.push(...Object.keys(this.host.schemas.get(cap, major)?.events ?? {}));
    if (events.length) {
      this.rpc.request('link.subscribe', { events }).catch((err) => this.host.log('warn', `Couldn't subscribe to ${this.peer?.name}: ${err.message}`));
    }
  }

  // ------------------------------------------------------------------ incoming

  onMessage(m, bytes) {
    this.lastHeard = Date.now();
    // The limit comes first: messages over it aren't logged or kept either.
    if (!this.withinRate(m)) return;
    if (this.host.watching?.()) this.report('in', m, bytes);
    if (this.state === 'authing' && !('result' in m || 'error' in m)) {
      if (this.queue.length >= QUEUE_MAX) return this.close('Too many messages before the pairing was proven');
      return void this.queue.push(m);
    }
    this.dispatch(m);
  }

  dispatch(m) {
    this.rpc.handle(m);
  }

  /** At most rateMax messages a second; going over it three times in a minute closes the connection. */
  withinRate(m) {
    const now = Date.now();
    const r = this.rate;
    if (now - r.windowStart >= 1000) {
      r.windowStart = now;
      r.count = 0;
    }
    r.count += 1;
    if (r.count <= this.host.timing.rateMax) return true;
    if (r.count === this.host.timing.rateMax + 1) {
      r.strikes = r.strikes.filter((t) => now - t < 60_000).concat(now);
      if (r.strikes.length >= this.host.timing.strikes) {
        this.close('Too many messages');
        return false;
      }
    }
    if ('id' in m && typeof m.method === 'string') this.rpc.fail(m.id, new GrapevineError(CODES.TOO_MANY, 'Too many messages: slow down'));
    return false;
  }

  async onRequest({ id, method, params }) {
    if (this.state === 'hello' && !this.initiator && method === 'link.hello') return this.handleHello(id, params);
    if (this.state === 'auth' && method === 'link.auth') return this.handleAuth(id, params);
    if (this.state !== 'ready') return this.rpc.fail(id, new GrapevineError(CODES.NOT_PAIRED, 'Say hello and prove the pairing first'));
    if (method === 'link.ping') return this.rpc.reply(id, {});
    if (method === 'link.subscribe') {
      const subscribed = this.host.subscribe(this, Array.isArray(params.events) ? params.events.filter((e) => typeof e === 'string') : []);
      this.rpc.reply(id, { subscribed });
      return this.host.afterSubscribe?.(this);
    }
    if (method === 'link.unpair') {
      for (const i of this.peerIds) this.host.keys.delete(i);
      this.rpc.reply(id, {});
      this.emit('unpaired');
      return this.close('Disconnected in the other app');
    }
    try {
      this.rpc.reply(id, await this.host.call(this, method, params));
    } catch (err) {
      this.rpc.fail(id, err instanceof GrapevineError ? err : new GrapevineError(CODES.INTERNAL_ERROR, 'The app failed to answer'));
      if (!(err instanceof GrapevineError)) this.host.log('error', `${method} failed: ${err?.message ?? err}`);
    }
  }

  onNotification({ method, params }) {
    if (method === 'link.bye') return this.close(`The other app said goodbye${params.reason ? ` (${params.reason})` : ''}`);
    if (this.state !== 'ready') return;
    const cap = this.host.schemas.capabilityOf(method);
    const agreed = cap && this.agreed.incoming.get(cap);
    if (!agreed) return this.host.log('warn', `Ignored ${method}: not agreed with ${this.peer.name}`);
    const problems = this.host.schemas.validate(cap, agreed.major, 'event', method, params);
    if (problems.length) return this.host.log('warn', `Dropped an invalid ${method} from ${this.peer.name}: ${problems.join('; ')}`);
    this.emit('event', method, params);
  }

  // ------------------------------------------------------------------ the end

  /** Says goodbye (a reason the other app can show) and closes. */
  bye(reason) {
    this.rpc.notify('link.bye', { reason });
    this.close(reason);
  }

  close(reason) {
    if (this.state === 'closed') return;
    const wasReady = this.state === 'ready';
    this.state = 'closed';
    this.closeReason = reason;
    clearTimeout(this.handshakeTimer);
    clearInterval(this.pingTimer);
    this.rpc.close();
    this.inflight.out.clear();
    this.inflight.in.clear();
    // end() lets a last reply (why it was refused) reach the other app; destroy() if it doesn't finish.
    this.socket.end();
    setTimeout(() => this.socket.destroy(), 500).unref?.();
    if (wasReady) this.host.log('info', `Disconnected from ${this.peer?.name}: ${reason}`);
    this.emit('close', reason, wasReady);
  }
}

module.exports = { Connection, TIMING, LOG_DATA_MAX, QUEUE_MAX };
