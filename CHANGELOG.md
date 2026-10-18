# What's new in Grapevine

## 0.5.1 (current)
- If an app's socket goes while its link is starting (its folder removed, say), `start()` fails with the error rather than throwing one the app can't catch.

## 0.5.0
- Each known app lists the capabilities it provides and uses, and `peers()` says what two apps share (`shares`), so an app's Connected apps page can describe any app without code of its own.
- `npm run released` records an app release that uses Grapevine: those capability versions can't change in place after that, and `firstRelease` fills in from it.
- The docs are checked against the schemas, and the repo has skills for changes, capabilities, pull requests, releases and recording an app's release.

## 0.4.0
- `drops.farming`'s `drop.rewards` can list every reward of the drop, with its picture, the minutes it unlocks at, whether it's claimed, ready or locked, and when a locked one should unlock. Enough for a widget to draw the reward track.

## 0.3.0
- `drops.farming` carries enough for another app to show it, in a top-bar widget say: the channel's picture, the stream's title and viewers, and the drop's picture, end, rewards claimed, the next reward and when it unlocks. All of them are optional.
- `drops.farming.show` asks the drops app to bring its window to the front.

## 0.2.0
- An app can be renamed: its hello lists the ids it had before (`formerIds`, `[]` until then), and apps paired with it carry on without pairing again. `link.currentId()` gives an app's new id from an old one.
- Of two apps, the one whose slug sorts first connects (it was the id), so a rename never changes which one connects.

## 0.1.1
- Published from GitHub with provenance: npm shows the commit and workflow that built it. The code is the same as 0.1.0.

## 0.1.0
- The first release: apps find each other through a private folder (named pipes on Windows), pair once with your OK in both, and trade versioned, schema-checked JSON-RPC messages.
- `drops.farming` 1.0 (Pear Drops) and `players` 1.0 (Stream Multiview).
- A Connected apps list with each app's logo, summary, download page, status and what's missing.
- A stand-in peer and example messages, for apps' own tests.
