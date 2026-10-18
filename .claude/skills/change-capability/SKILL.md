---
name: change-capability
description: Add a capability to Grapevine, or change one (a new field, event or method, or a breaking change) - decide which version it is under the rules, then update the schema, example messages, generated types, PROTOCOL.md and README together. Use for any change to schemas/ or to what apps send each other.
---

# Add or change a capability

A capability (`drops.farming`, `players`) is what one app provides and others use. Its schema in `schemas/<name>/<major>.json` is the source of truth: the checker, the types and the docs all follow it.

## 1. Which version is it?

Look in `schemas/released.json` first: a version listed there has shipped in an app's release.

| The change                                                                                                     | Version                                                                                                                               |
| -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| A new capability                                                                                               | `schemas/<name>/1.json`, `"major": 1, "minor": 0`                                                                                     |
| Optional fields, new events or methods, values in an `x-open` list, to a version **not** in `released.json`    | Edit it in place: nothing out there uses it yet                                                                                       |
| The same, to a version that **is** in `released.json`                                                          | A new minor: raise `"minor"` in the same file                                                                                         |
| Removing or renaming a field, a new type or meaning, an optional field made required, a value in a closed list | A new major: a new file `<major + 1>.json`, with the old one kept. Apps that provide it offer both for at least two of their releases |

`test/released.test.js` fails if a released version changes without its minor going up.

## 2. Make the change, all of it

1. **The schema:** `"$ref": "#Name"` for the file's own `defs`, `"common:Name"` for `schemas/common.json`. Pictures are `common:Image` (`https` only, never an app's own scheme). Optional fields aren't in `required`. A list that may grow is `"x-open": [...]`, not `"enum"`.
2. **Example messages** in `fixtures/<name>/<major>/`: at least one good and one bad for what changed. Made-up channels and accounts only.
3. **Types:** `npm run types` (writes `types/capabilities.d.ts`).
4. **`PROTOCOL.md`:** its section `### \`<name>\` <major>.<minor>`, naming every event, method and field.
5. **README:** the Capabilities table (`` `<name>` <major>.<minor> ``), and the usage example if it's the main capability.
6. **Known apps:** `provides` / `uses` in `src/known-apps.js` for apps that will provide or use it.

`npm test` checks the examples against the schema, and that `PROTOCOL.md` and the README name everything. `npm run check` fails if the types are out of date.

## 3. After the release

Each app that provides or uses it needs its own change (and its tests run the new examples from `@streamorchard/grapevine/fixtures`). When an app ships a release with it, follow `app-shipped`.
