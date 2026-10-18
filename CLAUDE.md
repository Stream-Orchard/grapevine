# Grapevine

The npm package `@streamorchard/grapevine`: lets desktop apps on the same computer find each other and talk. `src/` is the library (no runtime dependencies, nothing from Electron), `schemas/` the capabilities, `fixtures/` example messages, `stand-in-peer.js` a stand-in app for other apps' tests, `types/` the TypeScript types. `PROTOCOL.md` is the protocol; `README.md` the API, development and releases.

## Working on a change

- Changes go on a branch and end as a pull request; never commit to `main`. Releases are a pull request that changes `version` in `package.json` and adds a `CHANGELOG.md` section, then a GitHub release `v<version>` (the Publish workflow publishes to npm). Don't change the version otherwise.
- Tests: `npm test`, `npm run test:coverage` (minimums: 90% lines, 80% branches, 90% functions), `npm run lint`, `npm run check`. Add tests next to similar ones for every new code path; `test/<file>.test.js` follows `src/<file>.js`, and `test/link.test.js` runs real sockets.
- It must work on Windows, macOS and Linux (CI runs all three). Paths go through `src/paths.js`.
- No runtime dependencies. Dev dependencies only for linting, formatting and type checks.
- Example messages and tests use made-up channels and accounts only (`pixelpear`, `pearfan`).

## Rules for the protocol

- The schemas are the source of truth: after changing one, run `npm run types` and update `fixtures/`.
- Follow the version rules in `PROTOCOL.md` ("Versions"): a capability's minor version only adds optional fields, events, methods or `x-open` values; anything else is a new major, offered next to the old one. The protocol number changes only for a break in the wire format, the hello or `link.*`.
- Keep `PROTOCOL.md` in step with the code: it's what another implementation would follow.
- A new app goes in `src/known-apps.js` with its logo in `assets/apps/`; `firstRelease` records which of its releases first had each capability version.
- Never send logins, tokens or cookies in a capability: usernames at most.
