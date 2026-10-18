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

/** The folder the sockets are actually in: the shared folder, or a short one in /tmp if its paths would be too long. */
function socketDir(place = {}) {
  const dir = linkDir(place);
  const { platform = process.platform, uid = process.getuid?.() ?? 0 } = place;
  if (platform === 'win32') return dir;
  const longest = path.join(dir, `${'x'.repeat(40)}.sock`);
  return Buffer.byteLength(longest) > MAX_SOCKET_PATH ? path.join('/tmp', `grapevine-${uid}-${tagOf(dir)}`) : dir;
}

/** The socket (or pipe) an app listens on. */
function socketPath(slug, place = {}) {
  if (!SLUG_RE.test(slug)) throw new Error(`"${slug}" isn't a valid app slug (a-z, 0-9 and -, up to 40)`);
  const { platform = process.platform } = place;
  if (platform === 'win32') return `\\\\.\\pipe\\grapevine-${tagOf(linkDir(place))}-${slug}`;
  return path.join(socketDir(place), `${slug}.sock`);
}

/** The slugs of every app with a socket in the folder right now (running, or left behind by a crash). */
function listSlugs(place = {}, fsImpl = fs) {
  const { platform = process.platform } = place;
  try {
    if (platform === 'win32') {
      const prefix = `grapevine-${tagOf(linkDir(place))}-`;
      return fsImpl
        .readdirSync('\\\\.\\pipe\\')
        .filter((n) => n.startsWith(prefix))
        .map((n) => n.slice(prefix.length))
        .filter((s) => SLUG_RE.test(s));
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

/** Creates the socket folder, private to this user. Refuses one owned by someone else. */
function ensureDir(place = {}, fsImpl = fs) {
  const { platform = process.platform } = place;
  if (platform === 'win32') return; // pipes don't live in a folder
  const dir = socketDir(place);
  fsImpl.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const uid = place.uid ?? process.getuid?.();
  const st = fsImpl.statSync(dir);
  if (uid !== undefined && st.uid !== uid) throw new Error(`${dir} belongs to another user`);
  if ((st.mode & 0o077) !== 0) fsImpl.chmodSync(dir, 0o700);
}

module.exports = { SLUG_RE, MAX_SOCKET_PATH, linkDir, tagOf, socketDir, socketPath, listSlugs, ensureDir };
