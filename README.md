# Sondage — proof of concept

A life-history interview between a Senior Fellow and a historian, recorded on the
Fellow's own computer exactly as it sounded, sealed so any change is detectable, and
encrypted so only the Fellow can open it. Around it: a life timeline, a journal, and
a way to get recordings back on a new computer or to an heir.

**Right now it runs as the first version, Sondage Resounder:** the Senior Fellow presses
**Connect**, talks with the Scholar for up to an hour, and either of them presses **Stop**.
One two-channel recording (the Senior Fellow left, the Scholar right, 32-bit float WAV) and
its Sitting record are filed under Stephen's names in a `vault` folder on the Senior
Fellow's desktop and copied to their own Dropbox, and a confirming email goes out. The
Scholar keeps no copy. Everything else is still here, behind
[feature switches](docs/how-it-works.md#feature-switches), off by default.

### Sondage in action

[![Sondage desktop app: sign in, journal, life story and recordings](docs/demo.gif)](docs/demo.gif)

The real desktop interface with demo data: signing in, answering a historian's
question in the journal, the life story, and checking a saved recording. Re-record it with
`python3 e2e/demo/record.py`.

## What's here

| Folder | What it is |
| --- | --- |
| `web/` | Rails 8 app: intake, 10x10 lists, timeline, journal, matching, scheduling, the historian's interview room, and the desktop app's API. |
| `desktop/` | Electron app for the Fellow: large text, one step per screen. Safety copies, the interview, sealing, listening, and `sondage-verify`. |
| `shared/` | Recorder, hash chain, chunk transfer and call, used by both apps (`scripts/sync-shared.sh` copies it in). |
| `e2e/` | End-to-end tests: Electron (Fellow) and Chrome (historian) hold a full interview against a stand-in server. |
| `docs/` | [How it works](docs/how-it-works.md), in detail. |

## Running it

Needs Ruby 3.3+, Node 22+ and headphones.

```bash
cd web && bin/setup && bin/rails server     # http://localhost:3000, with demo data
cd desktop && npm install && npm start      # the Fellow's app
```

People download the app from `/download` on the website, which offers the installer for
their computer (Mac, Windows or Linux). Push a version tag (`git tag v0.1.0 && git push
origin v0.1.0`) to build the installers and publish them; see
[Releasing the app](docs/how-it-works.md#releasing-the-desktop-app).

Demo accounts, password `sondage-demo-2026`: `admin@sondage.test`,
`historian@sondage.test`, and `eleanor@sondage.test` (the Senior Fellow; also signs in to
the desktop app).

**A demo Sitting:** start the web app with `SITTING_MINUTES=20 bin/rails server`. As the
Scholar, open Eleanor's Sitting in a browser and press **Join**. In the desktop app, as
Eleanor, press **Connect**. Talk, then press **Stop** on either side. The files appear
in `vault` on the desktop. For the Dropbox copy, see
[Connecting Dropbox](docs/how-it-works.md#connecting-dropbox-for-the-demo).
`SONDAGE_FEATURES=all` switches every earlier feature back on.

Tests: `npm test` in `desktop/`, `bin/rails test` in `web/`, and in `e2e/`
`SONDAGE_FEATURES= SITTING_MINUTES=1 node server.mjs &` then `node e2e-sitting.mjs` for the
first version. For the full set,
`node server.mjs &` then `node e2e-call.mjs` (under `xvfb-run` on Linux). CI runs all of
them, plus checks that the shared copies and published script hashes are current.

## How it works

- **Raw.** Each person's microphone is recorded on their own device as 32-bit float WAV,
  with every browser processing stage off. (The OS or a headset can still process sound
  unseen, so the promise is "nothing the app could detect or switch off".)
- **Unchanged.** Every 10-second chunk is hashed into a chain. The historian's page
  witnesses the Fellow's chunks live and refuses to sign anything that differs; then both
  sign (Ed25519), a trusted timestamp is requested, and the capsule is an OCFL object.
- **Theirs alone.** Keys stay in the Fellow's keychain; the capsule is encrypted with
  [age](https://age-encryption.org). Recordings never pass through a server; Sondage
  gets only a public receipt.
- **Never lost.** The key is split into four safety copies (any two rebuild it), and
  Sondage's copy is always one of the two, released only after a waiting period and a
  phone call. An heir gets only the half that opens recordings, never the one that signs.
- **Checkable without Sondage.** `sondage-verify`, or `VERIFY.txt` inside each capsule;
  compare the key fingerprints with the printed certificate.
- **Human-made.** No AI anywhere in collection, recording or transcription.

Details, including what's inside a capsule, heirs, the TURN relay, the journal and
matching: [docs/how-it-works.md](docs/how-it-works.md).

## Status

A proof of concept. The sealing tests and end-to-end runs passed before the latest
hardening changes; those changes, and the Rails app, haven't run yet, so expect small
fixes on the first CI run. Before real Fellows use it: boot and test the Rails app, set
up a TURN relay, get Apple and Windows signing certificates, choose a timestamp authority, get Sondage's answers
on key custody and compressed video in writing, and test safety-copy setup with two or
three real Fellows. [Full list](docs/how-it-works.md#before-this-goes-in-front-of-a-fellow-full-list).
