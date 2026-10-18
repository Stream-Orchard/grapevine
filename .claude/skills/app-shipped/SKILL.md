---
name: app-shipped
description: Record in Grapevine that an app (Pear Drops, Stream Multiview, …) has shipped a release using it - fixes the capability versions it uses so they can't change in place, and fills in which release first had them, for the "update <app> to <version>" messages. Use after an app publishes a release with a new or changed Grapevine capability.
---

# An app shipped a release that uses Grapevine

Once a release of an app uses a capability version, other apps' copies of Grapevine expect it not to change. Recording it here:

- `test/released.test.js` then stops that version from changing in place: further changes go in a new minor.
- `firstRelease` in the known-apps list fills in, so a card can say "update Pear Drops to 0.1.6 or later" rather than just "update Pear Drops".

## Steps

1. Check the app's release: its version, and which Grapevine version it was built with (its lock file).
2. In a Grapevine worktree (`start-change`), on a branch like `record/pear-drops-0.1.6`:

   ```sh
   npm run released -- <app id> <its version>     # e.g. com.streamorchard.peardrops 0.1.6
   ```

   It records each capability the app provides or uses (from `src/known-apps.js`) at its current version, and the protocol, in `schemas/released.json`. A first release already recorded stays.

3. Check the diff: only `schemas/released.json`, with the versions you expect.
4. `npm test`, then a PR (`open-pr`), then a patch release (`release`) so apps get the new `firstRelease`.

If the app was built with an older Grapevine than `main`, record against that version's schemas: check out its tag (`git worktree add .worktrees/at-v<x> v<x>`), run the command there, and copy the entries across.
