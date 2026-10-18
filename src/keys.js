// Where an app keeps its pairing keys: one small file in its own data folder, private to the user,
// encrypted with the app's own encrypt/decrypt (Electron's safeStorage) when it has them.
'use strict';

const fs = require('fs');
const path = require('path');

/**
 * @typedef {object} KeyStore
 * @property {boolean} [encrypted] whether keys are encrypted at rest
 * @property {(id: string) => {key: string, pairedAt?: string} | null} get
 * @property {(id: string, key: string) => void} set
 * @property {(id: string) => void} delete
 */

/**
 * @param {string} file e.g. <userData>/grapevine.json
 * @param {{encrypt?: (text: string) => string, decrypt?: (stored: string) => string}} [crypt]
 *   encrypt returns text to store (base64, say) and decrypt reverses it. Without them, keys are stored as they are.
 * @returns {KeyStore}
 */
function fileKeyStore(file, { encrypt, decrypt } = {}) {
  /** @type {Record<string, {key: string, pairedAt: string, encrypted?: boolean}>} */
  let peers = {};
  try {
    peers = JSON.parse(fs.readFileSync(file, 'utf8')).peers ?? {};
  } catch {}

  const save = () => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ peers }, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, file); // all at once: a crash never leaves half a file
  };

  return {
    /** Whether keys are encrypted at rest, for the card to say so if not. */
    encrypted: !!(encrypt && decrypt),
    get(id) {
      const p = peers[id];
      if (!p) return null;
      try {
        return { key: p.encrypted && decrypt ? decrypt(p.key) : p.key, pairedAt: p.pairedAt };
      } catch {
        return null; // can't decrypt (another user, a new keychain): as good as not paired
      }
    },
    set(id, key) {
      peers[id] = encrypt && decrypt ? { key: encrypt(key), encrypted: true, pairedAt: new Date().toISOString() } : { key, pairedAt: new Date().toISOString() };
      save();
    },
    delete(id) {
      if (!(id in peers)) return;
      delete peers[id];
      save();
    },
  };
}

/** Keys kept in memory only: for tests and the stand-in peer. @returns {KeyStore} */
function memoryKeyStore() {
  const peers = new Map();
  return {
    encrypted: false,
    get: (id) => peers.get(id) ?? null,
    set: (id, key) => void peers.set(id, { key, pairedAt: new Date().toISOString() }),
    delete: (id) => void peers.delete(id),
  };
}

module.exports = { fileKeyStore, memoryKeyStore };
