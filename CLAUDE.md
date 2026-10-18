# Grapevine

The npm package `@streamorchard/grapevine`: lets desktop apps on the same computer find each other and talk. `src/` is the library (no runtime dependencies, nothing from Electron), `schemas/` the capabilities, `fixtures/` example messages, `stand-in-peer.js` a stand-in app for other apps' tests, `types/` the TypeScript types. `PROTOCOL.md` is the protocol; `README.md` the API, development and releases.

## Working on a change

- Use the skills in `.claude/skills/`:
  - `start-change`: plan, branch and worktree
  - `change-capability`: anything in `schemas/`, or what apps send each other
  - `open-pr`
  - `release`: to npm
  - `app-shipped`: after an app ships a release that uses Grapevine
- Changes go on a branch and end as a pull request; never commit to `main`. Only a release pull request changes `version` in `package.json` or `CHANGELOG.md`.
- Tests: `npm test`, `npm run test:coverage` (90% lines, 80% branches, 90% functions), `npm run lint`, `npm run check`. Add tests next to similar ones for every new code path: `test/<file>.test.js` follows `src/<file>.js`, and `test/link.test.js` runs real sockets.
- It must work on Windows, macOS and Linux (CI runs all three). Paths go through `src/paths.js`.
- No runtime dependencies. Dev dependencies only for linting, formatting and type checks.
- Example messages and tests use made-up channels and accounts only (`pixelpear`, `pearfan`).

## Rules for the protocol

- **The schemas are the source of truth.** After changing one, run `npm run types` and update `fixtures/`.
- **Docs in the same change.** `PROTOCOL.md` is what another implementation follows, and the README is the API. `test/docs.test.js` fails if either misses a capability, event, method or field.
- **Versions** (`PROTOCOL.md`, "Versions"):
  - a capability's minor version only adds optional fields, events, methods or `x-open` values
  - anything else is a new major, offered next to the old one
  - the protocol number changes only for a break in the wire format, the hello or `link.*`
- **A version in `schemas/released.json` has shipped in an app and can't change in place.** `test/released.test.js` checks it. A version not listed there can still be edited.
- **Record each app release that uses Grapevine with `npm run released`** (the `app-shipped` skill). It also fills in each known app's `firstRelease`.
  - Apps declare what they speak in their `package.json`'s `grapevine` field.
  - Their `start-change` runs `npx grapevine-check` (`scripts/check-shipped.js`), which prints the command for any release not yet recorded.
- **A new app goes in `src/known-apps.js`:** its logo in `assets/apps/`, and the capabilities it `provides` and `uses`.
- **Never send logins, tokens or cookies in a capability:** usernames at most. Pictures are `https` addresses.
- **Apps on the other end:** Pear Drops (`Stream-Orchard/pear-drops`) and Stream Multiview (`GlowingPear/stream-window-multiview`). A capability change usually needs a follow-up there; say so in the pull request.
