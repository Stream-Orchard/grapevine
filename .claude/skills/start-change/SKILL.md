---
name: start-change
description: Start a change to Grapevine (bug fix, feature, a capability, a new app, docs) - plan it, create its branch in a separate git worktree, build and check it, then hand over to open-pr. Use when asked to fix, add or change something in this repo, or to work on an issue.
---

# Start a change

Every change goes on its own branch in its own worktree and ends as a pull request. Never commit to `main`.

## 1. What's the change?

- If the request describes it, or names an issue (`#12` or a URL), use that: `gh issue view <n> --comments`.
- If nothing was given, ask once: "What's the change? A short description or an issue number/URL."

## 2. Plan (read-only, before changing code)

Read the code it touches (`README.md` has the layout), then show a short plan and wait for approval:

- **Why:** the problem in a line or two, plus `Fixes #<n>` if there's an issue.
- **Changes:** which files, and how.
- **Protocol:** does it change what goes over the wire? Then it's a capability change (follow `change-capability`) or a protocol change (`PROTOCOL.md`, "Versions": the protocol number only goes up for a break in the wire format, the hello or `link.*`).
- **Apps:** does Pear Drops or Stream Multiview need a change to use it? Say which, as a follow-up in that app's repo.
- **Tests:** which new tests, next to similar ones in `test/`.
- **Branch:** e.g. `fix/12-reconnect-backoff` or `feat/clips-capability`. Pick it yourself.

## 3. Create the worktree

```sh
git fetch origin
git worktree add .worktrees/<branch-with-dashes> -b <branch> origin/main
cd .worktrees/<branch-with-dashes> && npm ci
```

Work only in that folder from now on. Remove it once the branch is merged: `git worktree remove .worktrees/<name>`.

## 4. Build and check

- Match the surrounding style. No runtime dependencies: `src/` uses Node's own modules only.
- It must work on Windows, macOS and Linux: paths go through `src/paths.js`.
- Add tests for every new code path. Example messages use made-up channels and accounts only (`pixelpear`, `pearfan`).
- Run `npm test`, `npm run lint`, `npm run check` and `npm run test:coverage` (90% lines, 80% branches, 90% functions).
- Docs in the same change: `PROTOCOL.md` for anything on the wire, the README for the API, the changelog only in a release (see `release`). `test/docs.test.js` fails if `PROTOCOL.md` or the README miss a capability, event, method or field.
- Commit in small, clear commits. Don't change the version: releases do that.

## 5. Hand over

When the developer is happy, follow `open-pr`.
