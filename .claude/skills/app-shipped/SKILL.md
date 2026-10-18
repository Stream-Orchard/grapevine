---
name: app-shipped
description: Record in Grapevine that an app (Pear Drops, Stream Multiview, …) has shipped a release using it - fixes the capability versions it uses so they can't change in place, and fills in which release first had them, for the "update <app> to <version>" messages. Use when an app's `npm run grapevine:check` lists releases to record (its start-change skill runs it), or after an app publishes a release with a new or changed Grapevine capability.
---

# An app shipped a release that uses Grapevine

Once a release of an app uses a capability version, other apps' copies of Grapevine expect it not to change. Recording it here:

- `test/released.test.js` then stops that version from changing in place: further changes go in a new minor.
- `firstRelease` in the known-apps list fills in, so a card can say "update Pear Drops to 0.1.6 or later" rather than just "update Pear Drops".

## Steps

1. **Find what's due.** In the app's repo, `npm run grapevine:check` (never `npx grapevine-check`: without Grapevine installed, `npx` would fetch a package of that name). It lists each release whose capability versions aren't recorded, with the exact command (the versions are the ones that release declared in its `package.json`).
2. **Record it.** In a Grapevine worktree (`start-change`), on a branch like `record/pear-drops-0.1.6`, run each command it printed:

   ```sh
   npm run released -- com.streamorchard.peardrops 0.1.6 drops.farming@1.0 players@1.0
   ```

   That writes `schemas/released.json`:
   - each version, with a fingerprint of its schema, so it can't change in place
   - which release first had it, and the protocol
   - A first release already recorded stays. A version that has had a later minor added since gets its first release, but no fingerprint (the file is the newer minor now).

3. **Check the diff:** only `schemas/released.json`, with the versions you expect.
4. **Ship it:** `npm test`, then a pull request (`open-pr`), then a patch release (`release`), so apps get the new `firstRelease`. Run `npm run grapevine:check` in the app again: it should say everything is recorded.
