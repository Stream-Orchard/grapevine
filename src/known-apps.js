// The apps that speak Grapevine, so each one can show the others on its Connected apps page,
// even when they aren't installed: name, summary, logo, where to get it, and which release first
// supported each capability version (to say "Update Pear Drops to 0.1.7"). Add a new app here.
'use strict';

const fs = require('fs');
const path = require('path');

const ICONS = path.join(__dirname, '..', 'assets', 'apps');

/**
 * @typedef {object} KnownApp
 * @property {string} id the app's install id (the hello's app.id)
 * @property {string} slug its socket name
 * @property {string} name
 * @property {string} summary one sentence, for its card
 * @property {string} icon a bundled 256×256 PNG
 * @property {string} homepage
 * @property {string} download its latest release
 * @property {string} dataFolder its folder in the OS's app data folder: no folder means not installed
 * @property {Record<string, string>} firstRelease "capability@major.minor" (or "protocol@N") -> the app version that first had it
 */

/** @type {KnownApp[]} */
const KNOWN_APPS = [
  {
    id: 'com.streamorchard.peardrops',
    slug: 'pear-drops',
    name: 'Pear Drops',
    summary: "Collects your Kick emote and badge drops for you, watching with Kick's own player.",
    icon: path.join(ICONS, 'pear-drops.png'),
    homepage: 'https://github.com/Stream-Orchard/pear-drops',
    download: 'https://github.com/Stream-Orchard/pear-drops/releases/latest',
    dataFolder: 'Pear Drops',
    firstRelease: {},
  },
  {
    id: 'com.glowingpear.streammultiview',
    slug: 'stream-multiview',
    name: 'Stream Multiview',
    summary: 'Watch Kick, Twitch and YouTube streams and chats side by side, with custom layouts, live alerts and color themes.',
    icon: path.join(ICONS, 'stream-multiview.png'),
    homepage: 'https://github.com/GlowingPear/stream-window-multiview',
    download: 'https://github.com/GlowingPear/stream-window-multiview/releases/latest',
    dataFolder: 'Stream Multiview',
    firstRelease: {},
  },
];

const byId = (id) => KNOWN_APPS.find((a) => a.id === id) ?? null;
const bySlug = (slug) => KNOWN_APPS.find((a) => a.slug === slug) ?? null;

/** Whether an app looks installed: its data folder exists (it's made the first time the app runs). */
function isInstalled(app, appDataDir, fsImpl = fs) {
  return fsImpl.existsSync(path.join(appDataDir, app.dataFolder));
}

/** An app's logo as a data URL, for a hello or an <img>. */
function iconDataUrl(file) {
  return `data:image/png;base64,${fs.readFileSync(file).toString('base64')}`;
}

module.exports = { KNOWN_APPS, byId, bySlug, isInstalled, iconDataUrl };
