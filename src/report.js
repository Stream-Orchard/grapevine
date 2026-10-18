// The compatibility report for a Connected apps card: works, works with something missing, or
// can't connect, and which app to update to which release. PROTOCOL.md, "Compatibility".
'use strict';

const { byId } = require('./known-apps');

/**
 * Which app needs updating so that both have `major` of `capability` (or protocol `major`).
 * @param {{id: string, name: string}} self
 * @param {{id: string, name: string}} peer
 * @param {number[]} mine majors this app has
 * @param {number[]} theirs majors the other app has
 * @param {string} feature "capability@" or "protocol@"
 */
function whoUpdates(self, peer, mine, theirs, feature) {
  const myTop = Math.max(0, ...mine);
  const theirTop = Math.max(0, ...theirs);
  // The app with the older versions is the one to update, to the newest the other one has.
  const [app, major] = theirTop < myTop ? [peer, myTop] : [self, theirTop];
  const version = byId(app.id)?.firstRelease?.[`${feature}${major}${feature === 'protocol@' ? '' : '.0'}`] ?? null;
  return { app: app.name, appId: app.id, version };
}

/**
 * @param {{id: string, name: string}} self
 * @param {{id: string, name: string}} peer
 * @param {{missing: {capability: string, direction: string, mine: number[], theirs: number[]}[]}} agreed
 * @returns {{state: 'works' | 'limited', missing: {capability: string, update: {app: string, appId: string, version: string | null}}[], text: string}}
 */
function compatibility(self, peer, agreed) {
  const missing = agreed.missing.map((m) => ({ capability: m.capability, update: whoUpdates(self, peer, m.mine, m.theirs, `${m.capability}@`) }));
  if (!missing.length) return { state: 'works', missing, text: 'Works' };
  const first = missing[0].update;
  const more = missing.length > 1 ? ` (and ${missing.length - 1} more)` : '';
  return {
    state: 'limited',
    missing,
    text: `Works, with a feature missing: update ${first.app}${first.version ? ` to ${first.version} or later` : ''}${more}`,
  };
}

/** The report when no protocol version is in common. */
function incompatible(self, peer, myProtocol, theirProtocol) {
  const span = (p) => Array.from({ length: p.max - p.min + 1 }, (_, i) => p.min + i);
  const update = whoUpdates(self, peer, span(myProtocol), span(theirProtocol), 'protocol@');
  return { state: 'incompatible', missing: [], update, text: `Can't connect: update ${update.app}${update.version ? ` to ${update.version} or later` : ''}` };
}

module.exports = { compatibility, incompatible, whoUpdates };
