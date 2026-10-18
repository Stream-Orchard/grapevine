---
name: release
description: Release Grapevine to npm - a pull request that sets the version and changelog, then a GitHub release that the Publish workflow tests and publishes with provenance. Use when asked to release, publish or ship Grapevine, or when an app needs a change that's merged but not released.
---

# Release Grapevine

Publishing is automatic from a GitHub release: the Publish workflow checks the tag matches `package.json`, runs every check and publishes to npm through trusted publishing (no token anywhere), with provenance.

## 1. The version

Semver for the package, separate from capability and protocol versions:

- **Patch** (`0.4.1`): fixes only.
- **Minor** (`0.5.0`): anything new (an API, a capability or field, a known app). While the package is `0.x`, a minor can also hold a break in the library's API; say so in the changelog.
- **Major** (`1.0.0`, and later): a break in the library's API.

## 2. The release pull request

On a branch `release/v<version>`:

1. `npm version <version> --no-git-tag-version` (package.json and the lock file).
2. A section at the top of `CHANGELOG.md`: `## <version> (current)`, with the previous one losing `(current)`. One line per change, in plain words.
3. Open the PR (`open-pr`), and merge it once its checks pass.

## 3. Publish

```sh
git switch main && git pull
gh release create v<version> --target main --title v<version> --notes "<that changelog section>"
```

Then watch the **Publish** run (`gh run list --workflow publish.yml`), and check `npm view @streamorchard/grapevine version` (it can take a few minutes to show).

## 4. Tell the apps

Apps pick it up with `npm install @streamorchard/grapevine@^<version>` in their own repo, as a pull request there. If a capability changed, each app's change goes with it.
