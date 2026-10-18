# What's new in Grapevine

## 0.3.0 (current)
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
