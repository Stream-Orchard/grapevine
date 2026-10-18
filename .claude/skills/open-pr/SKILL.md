---
name: open-pr
description: Open a pull request for a Grapevine change - run every check, write the description from the PR template, show the draft for approval, then push and create it with gh. Use when a change is ready for review or the developer asks to open a PR.
---

# Open a pull request

## 1. Check the branch

It must not be `main`. Only a release (see `release`) changes `version` in `package.json` or `CHANGELOG.md`.

## 2. Run the checks

`npm test`, `npm run lint`, `npm run check`, `npm run test:coverage`, and `npm pack --dry-run` if the files in the package changed. CI runs the tests on Windows, macOS and Linux too. Report what was run and its results honestly in the PR.

## 3. Write the draft

Follow `.github/pull_request_template.md`, in plain words and short bullets. A protocol or schema change says which version rule it follows (`PROTOCOL.md`, "Versions"), and which apps need a follow-up. Save the body in the temp folder, not the repo.

## 4. Show the draft and wait

Show the title and body. Don't push until the developer approves.

## 5. Push and create

```sh
git push -u origin <branch>
gh pr create --base main --title "<title>" --body-file <body.md>
```

## 6. After merging

Remove the worktree (`git worktree remove .worktrees/<name>`). If the change should reach apps, follow `release`.
