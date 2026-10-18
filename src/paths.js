// Where each app's socket lives. One shared, private folder per user (a named pipe prefix on
// Windows), so apps find each other by listing it. PROTOCOL.md, "Finding apps".
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
const MAX_SOCKET_PATH = 100; // macOS allows 104 bytes for a socket path, Linux 108

/**
 * @typedef {object} Place
 * @property {NodeJS.Platform} [platform]
 * @property {NodeJS.ProcessEnv} [env]
 * @property {string} [home]
 * @property {number} [uid]
 */

/** The shared folder: GRAPEVINE_DIR if set (tests, dev copies), else the OS's per-user place. */
function linkDir({ platform = process.platform, env = process.env, home = os.homedir() } = {}) {
  if (env.GRAPEVINE_DIR) return env.GRAPEVINE_DIR;
  if (platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'Grapevine');
  if (platform === 'win32') return path.join(env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'Grapevine');
  return env.XDG_RUNTIME_DIR ? path.join(env.XDG_RUNTIME_DIR, 'grapevine') : path.join(home, '.local', 'state', 'grapevine');
}

/** A short tag for the folder, so pipes of different users (or test folders) never mix on Windows. */
function tagOf(dir) {
  return crypto.createHash('sha256').update(dir.toLowerCase()).digest('hex').slice(0, 8);
}

const SECRET_FILE = 'pipe-secret';
const SECRET_RE = /^[0-9a-f]{32}$/;
/**
 * Windows: a random secret in the shared folder (in the user's own %APPDATA%, which other users can't read),
 * made by the first app that needs it. It goes into the pipes' names, so another user of the computer
 * can't work them out ahead of time and take one first.
 */
function pipeSecret(place = {}, fsImpl = fs) {
  const dir = linkDir(place);
  const file = path.join(dir, SECRET_FILE);
  const read = () => {
    try {
      const s = String(fsImpl.readFileSync(file, 'utf8')).trim();
      return SECRET_RE.test(s) ? s : null;
    } catch {
      return null;
    }
  };
  const have = read();
  if (have) return have;
  fsImpl.mkdirSync(dir, { recursive: true });
  const fresh = crypto.randomBytes(16).toString('hex');
  try {
    fsImpl.writeFileSync(file, fresh, { flag: 'wx', mode: 0o600 });
    return fresh;
  } catch (err) {
    if (/** @type {NodeJS.ErrnoException} */ (err).code !== 'EEXIST') throw err;
  }
  const theirs = read(); // another app made it at the same moment
  if (theirs) return theirs;
  fsImpl.writeFileSync(file, fresh, { mode: 0o600 }); // there, but not a secret: replaced
  return fresh;
}

/** The tag in Windows pipe names: the folder and its secret. */
function pipeTag(place = {}, fsImpl = fs) {
  return crypto
    .createHash('sha256')
    .update(`${linkDir(place).toLowerCase()}\n${pipeSecret(place, fsImpl)}`)
    .digest('hex')
    .slice(0, 16);
}
const PIPES = '\\\\.\\pipe\\';
/** Windows: the name copies with an older Grapevine use (the folder's tag only), which apps still answer and look for. */
function legacyPipe(slug, place = {}) {
  if (!SLUG_RE.test(slug)) throw new Error(`"${slug}" isn't a valid app slug (a-z, 0-9 and -, up to 40)`);
  return `${PIPES}grapevine-${tagOf(linkDir(place))}-${slug}`;
}

/** The folder the sockets are actually in: the shared folder, or a short one in /tmp if its paths would be too long. */
function socketDir(place = {}) {
  const dir = linkDir(place);
  const { platform = process.platform, uid = process.getuid?.() ?? 0 } = place;
  if (platform === 'win32') return dir;
  const longest = path.join(dir, `${'x'.repeat(40)}.sock`);
  return Buffer.byteLength(longest) > MAX_SOCKET_PATH ? path.join('/tmp', `grapevine-${uid}-${tagOf(dir)}`) : dir;
}

/** The socket (or pipe) an app listens on. */
function socketPath(slug, place = {}, fsImpl = fs) {
  if (!SLUG_RE.test(slug)) throw new Error(`"${slug}" isn't a valid app slug (a-z, 0-9 and -, up to 40)`);
  const { platform = process.platform } = place;
  if (platform === 'win32') return `${PIPES}grapevine-${pipeTag(place, fsImpl)}-${slug}`;
  return path.join(socketDir(place), `${slug}.sock`);
}

/** Where to reach an app that's running: its socket; on Windows its pipe, or the older name if that's all it has. */
function findSocket(slug, place = {}, fsImpl = fs) {
  const { platform = process.platform } = place;
  if (platform !== 'win32') return socketPath(slug, place, fsImpl);
  const current = socketPath(slug, place, fsImpl),
    legacy = legacyPipe(slug, place);
  let names = [];
  try {
    names = fsImpl.readdirSync(PIPES);
  } catch {}
  const listed = (p) => names.includes(p.slice(PIPES.length));
  return listed(current) || !listed(legacy) ? current : legacy;
}

/** The slugs of every app with a socket in the folder right now (running, or left behind by a crash). */
function listSlugs(place = {}, fsImpl = fs) {
  const { platform = process.platform } = place;
  try {
    if (platform === 'win32') {
      const prefixes = [`grapevine-${pipeTag(place, fsImpl)}-`, `grapevine-${tagOf(linkDir(place))}-`];
      const slugs = new Set();
      for (const n of fsImpl.readdirSync(PIPES)) {
        const prefix = prefixes.find((x) => n.startsWith(x));
        if (prefix && SLUG_RE.test(n.slice(prefix.length))) slugs.add(n.slice(prefix.length));
      }
      return [...slugs];
    }
    return fsImpl
      .readdirSync(socketDir(place))
      .filter((n) => n.endsWith('.sock'))
      .map((n) => n.slice(0, -5))
      .filter((s) => SLUG_RE.test(s));
  } catch {
    return [];
  }
}

/**
 * Creates the socket folder, private to this user. Refuses one owned by someone else, or a link (in /tmp,
 * another user could have made either first). Windows: the shared folder, for the pipes' secret.
 */
function ensureDir(place = {}, fsImpl = fs) {
  const { platform = process.platform } = place;
  if (platform === 'win32') return void pipeSecret(place, fsImpl);
  const dir = socketDir(place);
  fsImpl.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const uid = place.uid ?? process.getuid?.();
  const st = fsImpl.lstatSync(dir);
  if (st.isSymbolicLink() || !st.isDirectory()) throw new Error(`${dir} isn't a folder`);
  if (uid !== undefined && st.uid !== uid) throw new Error(`${dir} belongs to another user`);
  if ((st.mode & 0o077) !== 0) fsImpl.chmodSync(dir, 0o700);
}

module.exports = { SLUG_RE, MAX_SOCKET_PATH, linkDir, tagOf, pipeSecret, pipeTag, legacyPipe, socketDir, socketPath, findSocket, listSlugs, ensureDir };
