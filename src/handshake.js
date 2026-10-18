// The hello: checking what an app says about itself, agreeing versions, and the pairing proofs.
// PROTOCOL.md, "Connecting and pairing" and "Versions".
'use strict';

const crypto = require('crypto');
const { SLUG_RE } = require('./paths');

const PROTOCOL = { min: 1, max: 1 }; // the protocol versions this library speaks
const ID_RE = /^[a-z0-9][a-z0-9.-]{2,99}$/;
const VERSION_RE = /^(\d+)\.(\d+)$/;
const NONCE_BYTES = 32;
const KEY_BYTES = 32;
const MAX_ICON = 256 * 1024;

/** "1.2" -> { major: 1, minor: 2 }, or null. */
function parseVersion(v) {
  const m = typeof v === 'string' ? VERSION_RE.exec(v) : null;
  return m ? { major: Number(m[1]), minor: Number(m[2]) } : null;
}

/**
 * { cap: '1.0' | ['1.0', '2.1'] } -> { cap: ['1.0', ...] }, checking every version.
 * @param {Record<string, string | string[]>} [list]
 * @returns {Record<string, string[]>}
 */
function normalizeList(list = {}) {
  /** @type {Record<string, string[]>} */
  const out = {};
  for (const [cap, versions] of Object.entries(list)) {
    /** @type {string[]} */
    const all = [].concat(versions);
    if (!all.length || !all.every(parseVersion)) throw new Error(`Bad versions for ${cap}: use "major.minor", like "1.0"`);
    out[cap] = all;
  }
  return out;
}

/** What goes in the hello's "capabilities": { cap: { provides: [...], uses: [...] } }. */
function helloCapabilities(provides, uses) {
  const out = {};
  for (const [cap, v] of Object.entries(provides)) out[cap] = { ...out[cap], provides: v };
  for (const [cap, v] of Object.entries(uses)) out[cap] = { ...out[cap], uses: v };
  return out;
}

const majors = (versions) =>
  new Map(
    (versions ?? [])
      .map(parseVersion)
      .filter(Boolean)
      .map((v) => [v.major, v.minor]),
  );

/**
 * Agrees, per capability, the highest major both apps support.
 * - incoming: capabilities this app uses that the other provides
 * - outgoing: capabilities this app provides that the other uses
 * - missing: ones one side wants and can't get (for the compatibility report)
 */
function agree(mine, theirs) {
  const incoming = new Map();
  const outgoing = new Map();
  const missing = [];
  const pick = (want, have) => {
    const common = [...majors(want).keys()].filter((m) => majors(have).has(m));
    return common.length ? Math.max(...common) : null;
  };
  for (const [cap, want] of Object.entries(mine.uses)) {
    const have = theirs?.[cap]?.provides;
    const major = pick(want, have);
    if (major !== null) incoming.set(cap, { major, minor: majors(have).get(major) });
    else missing.push({ capability: cap, direction: 'incoming', mine: [...majors(want).keys()], theirs: [...majors(have).keys()] });
  }
  for (const [cap, have] of Object.entries(mine.provides)) {
    const want = theirs?.[cap]?.uses;
    if (!want) continue; // they don't use it: nothing to send
    const major = pick(want, have);
    if (major !== null) outgoing.set(cap, { major, minor: majors(have).get(major) });
    else missing.push({ capability: cap, direction: 'outgoing', mine: [...majors(have).keys()], theirs: [...majors(want).keys()] });
  }
  return { incoming, outgoing, missing };
}

/** The highest protocol version both ranges include, or null. */
function agreeProtocol(a, b) {
  const top = Math.min(a.max, b.max);
  return top >= Math.max(a.min, b.min) ? top : null;
}

const nonce = () => crypto.randomBytes(NONCE_BYTES).toString('base64');
const newKey = () => crypto.randomBytes(KEY_BYTES).toString('base64');

/** HMAC-SHA256 of "<role>:<nonce>" with the pairing key: proves an app knows the key without sending it. */
function proof(keyB64, role, n) {
  return crypto.createHmac('sha256', Buffer.from(keyB64, 'base64')).update(`${role}:${n}`).digest('base64');
}

function proofOk(keyB64, role, n, given) {
  if (typeof given !== 'string') return false;
  const want = Buffer.from(proof(keyB64, role, n), 'base64');
  const got = Buffer.from(given, 'base64');
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

const isHttps = (u) => typeof u === 'string' && /^https:\/\/[^\s]+$/.test(u) && u.length <= 500;

/** Problems with an app's description in a hello ("app.id: …"), empty when it's fine. */
function checkApp(app) {
  const p = [];
  if (!app || typeof app !== 'object') return ['app: missing'];
  if (typeof app.id !== 'string' || !ID_RE.test(app.id)) p.push('app.id: lowercase letters, digits, dots and dashes, like com.example.app');
  if (typeof app.slug !== 'string' || !SLUG_RE.test(app.slug)) p.push('app.slug: lowercase letters, digits and dashes');
  if (typeof app.name !== 'string' || !app.name || app.name.length > 100) p.push('app.name: 1 to 100 characters');
  if (typeof app.version !== 'string' || !app.version || app.version.length > 40) p.push('app.version: 1 to 40 characters');
  if (app.summary !== undefined && (typeof app.summary !== 'string' || app.summary.length > 300)) p.push('app.summary: up to 300 characters');
  if (app.icon !== undefined && (typeof app.icon !== 'string' || !app.icon.startsWith('data:image/png;base64,') || app.icon.length > MAX_ICON))
    p.push('app.icon: a PNG data URL, up to 256 KB');
  for (const k of ['homepage', 'download']) if (app[k] !== undefined && !isHttps(app[k])) p.push(`app.${k}: an https address`);
  if (
    app.formerIds !== undefined &&
    (!Array.isArray(app.formerIds) || app.formerIds.length > 10 || !app.formerIds.every((i) => typeof i === 'string' && ID_RE.test(i) && i !== app.id))
  ) {
    p.push('app.formerIds: up to 10 ids it had before, not its own');
  }
  return p;
}

/** Problems with a hello's params, empty when it's fine. */
function checkHello(params) {
  const p = checkApp(params?.app);
  const pr = params?.protocol;
  if (!pr || !Number.isInteger(pr.min) || !Number.isInteger(pr.max) || pr.min < 1 || pr.max < pr.min) p.push('protocol: { min, max } whole numbers');
  if (!params?.capabilities || typeof params.capabilities !== 'object' || Array.isArray(params.capabilities)) p.push('capabilities: an object');
  const auth = params?.auth;
  if (!auth || typeof auth.nonce !== 'string' || Buffer.from(auth.nonce, 'base64').length !== NONCE_BYTES) p.push('auth.nonce: 32 random bytes, base64');
  if (auth && auth.pair !== undefined && typeof auth.pair !== 'boolean') p.push('auth.pair: true or false');
  return p;
}

module.exports = { PROTOCOL, ID_RE, parseVersion, normalizeList, helloCapabilities, agree, agreeProtocol, nonce, newKey, proof, proofOk, checkApp, checkHello };
