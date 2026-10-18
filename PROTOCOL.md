# The Grapevine protocol

Version 1. How desktop apps on the same computer find each other, pair, and talk. The library in `src/` implements all of it; another implementation that follows this document can talk to it.

- [Finding apps](#finding-apps)
- [Messages](#messages)
- [Connecting and pairing](#connecting-and-pairing)
- [Once connected](#once-connected)
- [Limits](#limits)
- [Errors](#errors)
- [Capabilities](#capabilities)
- [Versions](#versions)
- [Renaming an app](#renaming-an-app)
- [Compatibility](#compatibility)
- [Security](#security)

## Finding apps

Every app has a **slug** (`a-z`, `0-9` and `-`, up to 40 characters, starting with a letter or digit) and listens on a socket named after it, in one folder shared by every Grapevine app of the same user.

| OS      | Shared folder                                                          | Socket                                           |
| ------- | ---------------------------------------------------------------------- | ------------------------------------------------ |
| macOS   | `~/Library/Application Support/Grapevine`                              | `<folder>/<slug>.sock`                           |
| Linux   | `$XDG_RUNTIME_DIR/grapevine`, or `~/.local/state/grapevine` without it | `<folder>/<slug>.sock`                           |
| Windows | `%APPDATA%\Grapevine`                                                  | the named pipe `\\.\pipe\grapevine-<tag>-<slug>` |

- `GRAPEVINE_DIR` replaces the shared folder (tests, developer copies).
- `<tag>` is the first 8 hex digits of the SHA-256 of the shared folder's path in lowercase. Pipes are visible to every user of a Windows computer; the tag keeps each user's (and each test folder's) apart.
- If `<folder>/<a 40-character slug>.sock` would be over 100 bytes (macOS allows 104 for a socket path), the sockets go in `/tmp/grapevine-<uid>-<tag>/` instead.
- The folder is created with mode `0700`, and an app refuses one owned by another user. Sockets are set to `0600`.
- An app finds the others by listing the folder (on Windows, the pipes with its `grapevine-<tag>-` prefix). It watches the folder for changes and lists it again every 5 seconds as well.
- A socket left by a crash answers nothing (`ECONNREFUSED`): its app deletes it and listens again when it starts. If something does answer, another copy of the app is running, and the new copy doesn't start its link.
- An app only listens, and only looks for others, while at least one of its Connected apps switches is on.

**Who connects.** Of two apps, the one whose slug sorts first (plain string order) connects; the other waits for it. So a pair never opens two connections. If they ever do, both keep the connection opened by the app whose slug sorts first and close the other with `link.bye { reason: "duplicate" }`. It's the slug, not the id, because an app's id can change (see [Renaming an app](#renaming-an-app)) and its socket's name doesn't.

## Messages

[JSON-RPC 2.0](https://www.jsonrpc.org/specification): one UTF-8 JSON object per line, ending in `\n`.

```text
{"jsonrpc":"2.0","id":7,"method":"drops.farming.get","params":{}}                 request
{"jsonrpc":"2.0","id":7,"result":{ … }}                                            its reply
{"jsonrpc":"2.0","id":7,"error":{"code":-32002,"message":"…","data":{ … }}}       an error reply
{"jsonrpc":"2.0","method":"drops.farming.changed","params":{ … }}                  an event (no id)
```

- `params` is always an object. Batches (an array of messages) aren't used, and get `-32600`.
- Names are `<capability>.<name>`. `link.*` is reserved for the link itself.
- Unknown fields anywhere are ignored, never an error.

## Connecting and pairing

The connecting app sends `link.hello` first:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "link.hello",
  "params": {
    "protocol": { "min": 1, "max": 1 },
    "app": {
      "id": "com.glowingpear.streammultiview",
      "formerIds": [],
      "slug": "stream-multiview",
      "name": "Stream Multiview",
      "version": "0.4.0",
      "summary": "Watch Kick, Twitch and YouTube streams…",
      "icon": "data:image/png;base64,…",
      "homepage": "https://github.com/GlowingPear/stream-window-multiview",
      "download": "https://github.com/GlowingPear/stream-window-multiview/releases/latest"
    },
    "capabilities": { "drops.farming": { "uses": ["1.0"] }, "players": { "provides": ["1.0"] } },
    "auth": { "nonce": "<32 random bytes, base64>", "pair": false }
  }
}
```

| Field                                 |                                                                                                                                               |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `protocol`                            | The range of protocol versions it speaks                                                                                                      |
| `app.id`                              | Its install id: lowercase letters, digits, dots and dashes, like `com.example.app` (3–100 characters)                                         |
| `app.formerIds`                       | The ids it had before a rename, up to 10. Always sent: `[]` until the app is renamed                                                          |
| `app.slug`, `app.name`, `app.version` | Required. `summary` (up to 300 characters), `icon` (a PNG data URL, up to 256 KB), `homepage` and `download` (`https` addresses) are optional |
| `capabilities`                        | For each capability, the versions it `provides` and `uses`, as `"major.minor"`                                                                |
| `auth.nonce`                          | 32 random bytes, base64, new for every connection                                                                                             |
| `auth.pair`                           | `true` when it has no key for this app yet                                                                                                    |

The listening app checks it, in this order:

1. A hello that doesn't fit the table gets `-32602` with `data.problems` (a list of strings), and the connection closes.
2. No protocol version in both ranges: `-32003` with `data.protocol` (its own range), and close.
3. Its switch for that app is off: `-32005`, and close. The app is known by `app.id` or any of `app.formerIds`, and the switch counts under any of them.
4. **Pairing.**
   - `pair: true` and it has no key for that app: it makes a new 32-byte random key `K`.
   - `pair: true` but it still has a key: `-32001` with `data: { reason: "pair-again", keyHeldBy: "listener" }`, and close. It accepts a new pairing only once its user presses **Pair again**, which deletes its key.
   - `pair: false` and it has no key: `-32001` with `data: { reason: "pair-again", keyHeldBy: "connector" }`, and close. The connecting app's user presses **Pair again** there.
   - Otherwise `K` is the key it has.
   - "Has a key" means one filed under `app.id` or any of `app.formerIds` (or a former id its own known-apps list gives that app).
5. It replies:

```json
{"jsonrpc":"2.0","id":1,"result":{
  "protocol":1,
  "app":{ … the listening app … },
  "capabilities":{ … its own … },
  "agreed":{"drops.farming":"1","players":"1"},
  "auth":{"proof":"<HMAC-SHA256(K, 'server:' + client nonce), base64>","nonce":"<32 random bytes>","key":"<K, only when pairing>"}}}
```

The connecting app checks the reply:

- its `app.id`, or one of its `app.formerIds`, is the app it meant to connect to;
- it speaks the `protocol` chosen;
- the `proof` matches its key, or the `key` it was just given when pairing.

If any check fails, it closes the connection. Then it proves it knows the key:

```json
{ "jsonrpc": "2.0", "id": 2, "method": "link.auth", "params": { "proof": "<HMAC-SHA256(K, 'client:' + listener nonce), base64>" } }
```

The listening app replies `{}` if the proof matches, or `-32001` with `reason: "pair-again"` and closes if it doesn't. Only now does either app keep a new key. The connection is ready.

- **Deadline:** `link.hello` and `link.auth` must both be done within 3 seconds of connecting.
- **Before ready:** any other request gets `-32001`.
- **Comparing proofs:** in constant time.
- **The roles in the proof** (`server:`, `client:`) mean a proof can't be sent back to the app that made it.

## Once connected

| Message                              |         |                                                                                                                                                                                                                                                                                                |
| ------------------------------------ | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `link.subscribe { events: [names] }` | request | The events it wants. The reply is `{ subscribed: [names] }`: the ones the other app provides, of capabilities agreed on this connection. The latest of each comes straight after the reply. Each app subscribes to every event of every capability it uses as soon as the connection is ready. |
| `link.ping {}`                       | request | Sent every 20 seconds by the connecting app. No reply within 10 seconds closes the connection. The listening app closes a connection it has heard nothing on for 60 seconds.                                                                                                                   |
| `link.unpair {}`                     | request | Disconnect: the app receiving it deletes its key, replies `{}`, and closes. The app sending it deletes its own and switches its own switch off, so the two don't pair straight back.                                                                                                           |
| `link.bye { reason }`                | event   | Closing on purpose: quitting, switched off, a duplicate. `reason` is a sentence the other app may show.                                                                                                                                                                                        |

When an app quits or crashes, its socket closes and the other app knows at once.

## Limits

|          |                                                                                                                                                |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| A line   | 1 MiB. A longer one closes the connection                                                                                                      |
| Messages | 50 a second. Beyond that, a request gets `-32004` and other messages are dropped. Going over three times within a minute closes the connection |
| A reply  | Expected within 10 seconds, unless the method says otherwise                                                                                   |

## Errors

The standard JSON-RPC codes, and Grapevine's:

| Code     | Meaning                                                                                                                                                                      |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `-32700` | Not JSON                                                                                                                                                                     |
| `-32600` | Not a valid request (not an object, no method, a bad id)                                                                                                                     |
| `-32601` | No such method, or the app doesn't answer it                                                                                                                                 |
| `-32602` | Invalid params (`data.problems` lists what's wrong)                                                                                                                          |
| `-32603` | The app failed to answer                                                                                                                                                     |
| `-32001` | Not paired, or the proof was wrong. `data.reason` is `"pair-again"` when one app has a key the other doesn't, and `data.keyHeldBy` says which: `"listener"` or `"connector"` |
| `-32002` | The capability wasn't agreed on this connection                                                                                                                              |
| `-32003` | No version both apps support (`data.protocol` is the sender's range)                                                                                                         |
| `-32004` | Too many messages                                                                                                                                                            |
| `-32005` | Switched off in the app's Connected apps                                                                                                                                     |

## Capabilities

A capability is a named feature one app provides and others use, defined by a JSON Schema in `schemas/<capability>/<major>.json`:

```json
{ "capability": "drops.farming", "major": 1, "minor": 0, "description": "…",
  "events":  { "drops.farming.changed": { "$ref": "#State" } },
  "methods": { "drops.farming.get": { "params": { … }, "result": { "$ref": "#State" } } },
  "defs":    { "State": { … } } }
```

`"$ref": "#Name"` points at the file's own `defs`, and `"$ref": "common:Name"` at the shared types in `schemas/common.json`:

| Type        |                                                                   |
| ----------- | ----------------------------------------------------------------- |
| `Timestamp` | ISO 8601, in UTC                                                  |
| `Platform`  | A streaming site: `kick`, `twitch`, `youtube`, or one added later |
| `Channel`   | `{ platform, slug, name? }`                                       |
| `Account`   | `{ platform, user }`: the username only, never a token or cookie  |
| `Progress`  | `{ done, total, unit }`, where `unit` is `minutes` for now        |

**Conventions.**

- **Events carry the whole state, not a change,** so a missed one is corrected by the next.
- **Every event has `seq`,** which counts up for each event name (from 1), **and `at`.**
- **A capability with a `<capability>.changed` event also answers `<capability>.get`** with the same shape (`seq` is the last one sent, or 0).
- **Lists marked `x-open` may gain values:** an app treats a value it doesn't know as the nearest safe meaning (for `drops.farming`'s `state`, "not farming").

### `drops.farming` 1.0

What a drops app is farming. Provided by Pear Drops.

| Field     |                                                                                                                            |
| --------- | -------------------------------------------------------------------------------------------------------------------------- |
| `state`   | `farming` (its player is watching a stream for drop credit), `waiting`, `paused`, `done`, `signed-out`, or one added later |
| `account` | The account it farms for, or `null`                                                                                        |
| `channel` | The stream it's watching while `farming`, else `null`                                                                      |
| `drop`    | `{ campaign, category, progress }` while farming, else `null`                                                              |

### `players` 1.0

An app's stream players, by site. Provided by Stream Multiview.

| Field       |                                                                                                                 |
| ----------- | --------------------------------------------------------------------------------------------------------------- |
| `platforms` | An object keyed by `Platform`. Each site has `{ signedIn, mode, account, open }`                                |
| `signedIn`  | Whether its players play as the account right now                                                               |
| `mode`      | `signed-in`, `signed-out`, `auto` (signed in except while a connected drops app is farming), or one added later |
| `open`      | The `Channel`s with a player open                                                                               |

## Versions

**Two kinds of version.**

- **The protocol** (a whole number) covers this document's wire format, the hello and `link.*`. It changes only if those change in a way an older app can't handle.
- **Each capability** has `major.minor`.

**A minor version only adds:**

- optional fields
- new events or methods
- values in `x-open` lists

An app that knows `1.0` works with `1.3` unchanged. An app mustn't depend on a field the other app's minor version doesn't have.

**A major version is a break:**

- a field removed or renamed
- a type or meaning changed
- an optional field made required
- a value added to a closed list

**Apps agree a major per capability in the hello:** the highest major both list. A provider keeps offering the old major next to the new one for at least two of its releases, so apps can update in either order. A version may be listed as deprecated in the provider's release notes before it's dropped.

**Messages carry no version.** Everything on a connection uses the majors agreed in its hello.

## Compatibility

After the hello, each app tells its user one of:

|                                   |                                                                                                                                                                            |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Works**                         | Every capability it uses was agreed                                                                                                                                        |
| **Works, with a feature missing** | A capability one app wants has no major in common. It names the app with the older versions and, if known, the release to update to: "update Pear Drops to 0.1.7 or later" |
| **Can't connect**                 | No protocol version in common. Again, it names the app to update                                                                                                           |

The releases come from the known-apps list (`src/known-apps.js`): `firstRelease` maps `"<capability>@<major>.<minor>"` and `"protocol@<n>"` to the first release of that app that had it.

## Renaming an app

An app's id can change, say from `com.glowingpear.streammultiview` to `com.streamorchard.streammultiview`. Apps paired with it under the old id carry on without pairing again:

1. **The renamed app lists its old id in its hello:** `"formerIds": ["com.glowingpear.streammultiview"]`. That's the only change it needs.
2. **Other apps find their key and their switch under any of its ids.** An app whose Grapevine predates the rename still knows it by the old id, and keeps working.
3. **The known-apps list gets the new id,** with the old one in its own `formerIds`. An app updated to it shows the new id, finds what was saved under the old one, and can move its own settings across.

Claiming a former id only says where to look for a key. The app still has to prove it holds that key, so it can't take over another app's pairing.

## Security

**Who can connect:**

- **Only programs running as the same user.** The folder and sockets are private to them. Windows pipes are named per user, but any user of the computer can open one; pairing covers that.
- **Never a web page.** Browsers can't open local sockets or named pipes at all.
- **Never another computer.** Nothing listens on the network.

**What pairing does:**

- **Proves it's the same app as last time.** After the first pairing, both apps prove they hold the same random key on every connection, without sending it.
- **The first pairing trusts whichever app answers to that id.** It happens only after the user has switched the link on in both apps.
- **Replacing a pairing takes a user's press of Pair again.**
- **What it can't stop:** a program already running as the user could read the keys, as it could read the apps' own logins.

**What goes across:** capabilities describe what an app is doing (farming a channel, players signed in or out). They never carry logins, tokens or cookies.
