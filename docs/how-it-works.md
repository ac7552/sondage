# How Sondage works

The detail behind the [README](../README.md).

## What's in each folder

| Folder | What it is |
| --- | --- |
| `web/` | Rails 8 web app: roles, intake form builder, 10x10 lists, the scroll-in timeline (photos, songs, articles, letters, places, events), timeline versions, scheduling, the historian's interview room, the desktop app's API, and call signaling over Action Cable. |
| `desktop/` | Electron app for the Fellow, written for someone who finds technology hard: one step per screen, very large text. Safety-copy setup, getting recordings back on a new computer, a headphone and microphone check, the interview, saving (sealing), listening, and the `sondage-verify` command. |
| `shared/` | Code used by both the desktop app and the historian's browser: the raw recorder, hash chain, chunk transfer and the call. `scripts/sync-shared.sh` copies it into both apps. |
| `e2e/` | An end-to-end test: the real Electron app (as the Fellow) and Chrome (as the historian) hold a full interview with synthetic microphones against a stand-in for the Rails app, then seal and verify the capsule. |
| `docs/screenshots/` | Screens captured from earlier test runs (before the editorial redesign). `docs/demo.gif` is current; re-record it with `python3 e2e/demo/record.py`. |

## Running it, in detail

Requirements: Ruby 3.3+, Node 20+, and headphones.

```bash
# 1. The web app (with demo data)
cd web
bin/setup            # bundle install, create the database, load demo data
bin/rails server     # http://localhost:3000

# 2. The desktop app (the Fellow)
cd desktop
npm install
npm start            # signs in to http://localhost:3000 by default
```

Sign-in uses [Devise](https://github.com/heartcombo/devise): "Forgot your password?" emails a reset link, and an account locks for an hour after 10 wrong passwords. In development, emails open in your browser instead of being sent (letter_opener).

If you already ran `bin/setup` with an earlier version, run `bin/rails db:migrate` to upgrade the database in place.

Demo accounts (password `sondage-demo-2026` for all three):

| Who | Email | Starts at |
| --- | --- | --- |
| Admin | `admin@sondage.test` | All Fellows, intake builder, scheduling |
| Historian | `historian@sondage.test` | Their interviews, questions, interview room |
| Fellow (Eleanor Ruiz, fictional) | `eleanor@sondage.test` | Her timeline, intake, 10x10. Signs in to the desktop app too. |

To hold a test interview on one machine:
1. Sign in as the historian in a browser and open the interview room.
2. Sign in to the desktop app as Eleanor. The first time, it walks her through her safety copies.
3. Click **Start my interview**. The historian then clicks **Start recording**, and later **End interview and save**.

The demo interview is a video interview. An admin can switch any interview between video and audio on its page.
Demo photographs are abstract stand-ins stamped DEMO; songs are real recordings, cited
rather than copied; clippings are labelled as demo.

The end-to-end test (needs Chrome; on Linux run it under `xvfb-run`):

```bash
cd desktop && npm install && cd ../e2e && npm install
node server.mjs &            # stand-in for the Rails app on :3999
node e2e-call.mjs            # full interview; screenshots in e2e/out/
```

`scripts/check-shared.sh` fails if the copies of `shared/` have drifted, and
`node scripts/script-hashes.mjs --check` fails if the published script hashes are out
of date. CI runs both, the desktop tests on macOS, Windows and Linux, the Rails tests,
and the end-to-end tests under xvfb.

## The first version: a Sitting

Stephen's first version of Sondage Resounder does one thing: a Certified Legacy Scholar and
a Senior Fellow meet by audio and video, talk for up to an hour, and the Senior Fellow
keeps a high-fidelity recording.

1. **Connect.** The Senior Fellow's home screen shows one Sitting and one button. Pressing
   **Connect** goes straight into the call; there are no check screens. The Scholar opens
   the Sitting in a browser and presses **Join**.
2. **Recording runs throughout,** from the moment both are connected. Only audio is
   recorded; video is live only. A countdown shows the time left (`SITTING_MINUTES`,
   60 by default).
3. **Stop.** Either person presses **Stop**. The Scholar's last pieces arrive, then the
   Senior Fellow's app builds one master, a 32-bit float WAV with two channels (the
   Senior Fellow on the left, the Scholar on the right, each untouched), and its Sitting
   record, and files them on the desktop:

   ```
   vault/sondage-archive/2027-ruiz-eleanor/v1/content/03-sittings/sitting-03/
     2027-ruiz-eleanor_sitting-03_master_2027-02-02.wav
     2027-ruiz-eleanor_sitting-03_sitting-record_2027-02-02.json
   ```

   The record holds the start and end times, the duration, the SHA-512 of the master and
   which channel is whose. Names follow Stephen's rules: the Season key
   (`{convocation year}-{surname}-{given name}`, lowercase, accents dropped) starts every
   file, Sitting numbers are two digits, dates are YYYY-MM-DD.
4. **The cloud copy.** The same files go to the Senior Fellow's own Dropbox, into the app's
   own folder (Dropbox → Apps → the app's name → `vault/...`). Each file is checked against
   Dropbox's own hash of what it stored.
5. **The email.** The app tells the Sondage server only when the Sitting started and
   stopped. The server sends the Senior Fellow a fixed-template email: date, times, who
   took part, and that it was a live conversation between two people with no AI. **The
   wording in `web/app/views/sitting_mailer/` is a placeholder until Stephen supplies
   Sondage's own.**
6. **The Scholar keeps nothing.** Once the Senior Fellow's computer has filed the master,
   the Scholar's browser deletes its copy.

Anything that can't finish (no internet, the computer asleep) waits in the app's outbox
and is retried every few minutes and at the next start. The Senior Fellow's Season (names
and Convocation year) is set when they're added, or on their page in the admin site.

**Not decided yet (questions for Stephen):** whether the master should be two channels or
one mixed track; whether each new Sitting should be a new OCFL version (`v2`, `v3`...)
with an inventory, as OCFL proper requires, rather than every Sitting under `v1`; and the
email's wording. Clock differences between the two computers aren't corrected, so the
two channels can be a fraction of a second apart.

## Feature switches

Everything beyond the first version is switched off unless named in `SONDAGE_FEATURES` on
the web app (comma-separated, or `all`). The desktop app and the Scholar's page read the
same list from the server. A switched-off feature's pages answer "not found".

| Switch | What it brings back |
| --- | --- |
| `intake`, `ten_by_ten`, `stages` | The intake questions, 10x10 lists, and the Fellow's stages |
| `timeline` | The life timeline (web and desktop) |
| `journal` | The journal and historians' questions |
| `matching` | Choosing a historian |
| `safety_copies` | Encryption keys, safety copies and recovery on a new computer |
| `heirs` | Opening recordings after a Fellow's death |
| `sealed_capsules` | Encrypted, co-signed capsules and receipts, instead of the first version's Sitting |
| `recordings_vault` | My recordings, listening and certificates in the app |
| `device_check` | The headphone and microphone steps before a Sitting |
| `room_checklist` | The Scholar's room checklist and test clip |
| `record_video` | Recording video (otherwise video is live only) |

The tests run with everything on (`web/test`), except where they test the first version.

## Connecting Dropbox (for the demo)

The app connects the Senior Fellow's **own** Dropbox. Sondage registers one Dropbox app
(once), and never holds anyone's sign-in.

1. At [dropbox.com/developers/apps](https://www.dropbox.com/developers/apps), create an app:
   **Scoped access**, **App folder**, any name (for example "Sondage").
2. On its **Permissions** tab, tick `account_info.read`, `files.metadata.read` and
   `files.content.write`, and press Submit.
3. On its **Settings** tab, add the redirect URI `http://127.0.0.1:53682/dropbox`, and
   copy the **App key**.
4. Start the web app with `DROPBOX_APP_KEY=<that key>`.

While the app is in Dropbox's "development" status, only a limited number of people can connect, which is
plenty for a demo. On a new computer the desktop app then shows **Where your Sittings are
kept**: press **Connect my Dropbox**, sign in to Dropbox in the browser, and press
**Allow**. The token stays in that computer's keychain. **Help** shows where the Sittings
are and can connect Dropbox later.

A free Dropbox account holds 2 GB, about 1.5 hours of two-channel master at 48 kHz, so
it's fine for a demo of 20-minute Sittings.

## Releasing the desktop app

The website's `/download` page offers the installer for the visitor's computer, with the
others below it and plain installation steps. Its buttons go to `/download/mac`,
`/download/windows` and `/download/linux`, which redirect to the newest GitHub release:

| Computer | File | Notes |
| --- | --- | --- |
| Mac | `Sondage-mac.dmg` | One app for Apple Silicon and Intel Macs, macOS 12 or later |
| Windows | `Sondage-windows.exe` | Installs itself and opens, no choices; Windows 10 or later |
| Linux | `Sondage-linux.AppImage` | 64-bit |

To release a version:

1. Once: set the repository variable `SONDAGE_SERVER_URL` (Settings → Secrets and
   variables → Actions → Variables) to the web app's address. It's built into the app, so
   people never type it. A release refuses to build without it.
2. Tag and push: `git tag v0.1.0 && git push origin v0.1.0`. `.github/workflows/release.yml`
   runs the tests, builds all three installers on Mac, Windows and Linux machines, and
   publishes them as a GitHub release. From then on `/download` hands out that version.

"Run workflow" on the Actions tab builds the installers without publishing, to try them.
Locally, `npm run dist:mac` (on a Mac), `dist:win` or `dist:linux` in `desktop/` builds one
into `desktop/dist/`.

**Signing.** Without certificates the installers are unsigned. On a Mac that's a real
obstacle for this audience: recent macOS won't open an unsigned app from the Finder at all
without a trip to System Settings → Privacy & Security → Open Anyway. Windows shows a
"Windows protected your PC" screen. To sign, add these repository secrets:

- Mac (needs an Apple Developer account): `MAC_CERTIFICATE` (base64 of the Developer ID
  Application `.p12`), `MAC_CERTIFICATE_PASSWORD`, and for notarization `APPLE_ID`,
  `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`.
- Windows: `WINDOWS_CERTIFICATE` (base64 of the `.pfx`) and `WINDOWS_CERTIFICATE_PASSWORD`.

The Mac app asks for the microphone and camera with its own explanation
(`NSMicrophoneUsageDescription`), and its hardened-runtime entitlements are in
`desktop/build/entitlements.mac.plist`. To host the files somewhere other than GitHub,
set `DESKTOP_DOWNLOAD_BASE` on the web app (or `DESKTOP_MAC_URL` and so on, one at a time),
and `DESKTOP_VERSION` to show the version on the page.

## The guarantees

**Unadulterated.** The live call is only for talking. Each person's microphone is
recorded separately on their own device, with echo cancellation, noise suppression,
automatic gain and voice isolation all switched off, as 32-bit float samples at the
device's own rate (no resampling), in 10-second chunks. The device check shows the
Fellow the processing the browser reports, and won't continue while any of it is on.
The promise is **no processing the app could detect or switch off**: the operating
system (Windows audio enhancements, macOS voice isolation) and some headsets can
process sound before the browser sees it, without reporting it. Video, when chosen, is
recorded locally too; it has to be compressed, so the manifest labels it as such and
the WAV audio stays the master record.

**Unchanged.** Every chunk is hashed the moment it's written, and each hash commits to
the one before it, so a missing, reordered or altered chunk breaks the chain. At the
end, the manifest describes every byte.

Both sides are witnessed by the other person. The historian's browser checks its own
tracks against what it recorded. The Fellow's app also sends the historian's page each
of its own chunks' hash and chain link as it's written, over the call; the page keeps
them (in its private storage, so a reload doesn't lose them) and refuses to sign if
the manifest's Fellow tracks differ, are missing pieces, or if any piece was reported
twice with different contents. So the co-signature means the historian saw the
Fellow's recording grow, live, not just a summary at the end. Then both people sign
the manifest (Ed25519).

An independent RFC 3161 authority timestamps its fingerprint; only the hash leaves the
computer. The signed manifest says whether a timestamp was asked for, and a seal
record (`seal.json`, signed by the Fellow) says whether it was granted and the hash of
the token, so removing or swapping `timestamp.tsr` is detected. The package is an OCFL
1.1 object with SHA-512 fixity.

**Whose keys.** A capsule's signatures prove that whoever holds the named keys signed
it; they don't say whose keys those are. That has to come from outside the capsule.
The verifier compares the keys with an outside record when given one
(`--fellow-key <fingerprint>`, `--historian-key`, or `--receipt`) and says plainly when
it hasn't. The desktop app checks the Fellow's own capsules against the key on that
computer. **Print a certificate** on each recording gives a one-page paper record of
both key fingerprints and the manifest fingerprint.

**Theirs alone.** The Fellow's keys are created on their computer, kept in the
operating system's keychain, and never seen by them. The capsule is encrypted with
[age](https://age-encryption.org) to the Fellow's key. The historian's recording
reaches the Fellow's computer over the call's encrypted data channel, never through a
server, and the historian's browser discards its copy after sealing. The web app
receives only a public receipt: fingerprints, signatures and the timestamp.

**Never lost: four safety copies.** At setup the key is split (Shamir, 2 of 4) into four
safety copies: one for the Fellow, one each for two people they trust, and one for
Sondage. One alone reveals nothing.

The two secrets, the key that opens capsules and the key that signs them, are split
separately; each copy holds one share of each (66 bytes + 66 bytes). That lets Sondage
give an heir only the opening half of its copy.
- The Fellow's and family's copies go out as emails **from the Fellow's own email app**, so they never pass through Sondage. Sondage stores its own copy (encrypted at rest) and only a fingerprint of the others.
- On a new computer, the Fellow clicks **Send the emails**. Each holder gets a short email and clicks the button in their safety email. Their copy travels only in the part of the link after `#`, which browsers never send to a server. It is encrypted in their browser to a one-time key made by the new computer, so the copies only ever come together there.
- **Sondage's copy is always one of the two.** Helpers' approvals are stored, but no piece reaches the new computer until an admin has phoned the Fellow on a number already on file and released Sondage's copy, after a waiting period (`RECOVERY_WAIT_HOURS`, 72 hours in production). Two helpers' copies never open anything on their own. This matters because the Fellow's own copy sits in the same inbox that resets their Sondage password: without the gate, someone who got into that inbox could rebuild the key with one relative's click.
- Everyone is emailed when a recovery starts and can stop it. The emails ask helpers to call the Fellow on a number they already have before clicking.
- The restored key is checked against the one registered for the account.

The safety page and the interview room run under a strict Content Security Policy (no
inline or third-party script; they can only talk to Sondage), so an injected script has
nowhere to send a piece. That can't protect against Sondage's own server sending
different code; for that, the SHA-384 of every script those pages run is published in
`web/public/sondage/hashes.json`, regenerated by `node scripts/script-hashes.mjs` and
checked in CI, so any change shows up in review and anyone can compare a live server
with the repository.

**Human-made.** No AI anywhere in collection, recording, transcription or
interpretation. Every capsule carries an empty Generative Information Package folder
saying so, and the manifest declares it. Context added to the timeline (a headline, a
song from that summer) is always labelled as context, with who added it.

### Inside a capsule (once opened)

```
0=ocfl_object_1.1
inventory.json (+ .sha512)          SHA-512 of every file
v1/content/
  manifest.json                     every file, its SHA-256, every chunk's hash and chain link,
                                    devices, processing settings, participants, provenance log
  signatures.json                   Fellow and historian, Ed25519 over manifest.json; Fellow over seal.json
  seal.json                         what happened at sealing: timestamp granted or not, and its hash
  timestamp.tsr                     RFC 3161 token (when the service was reachable)
  audio/fellow-audio.wav            32-bit float, one channel
  audio/historian-audio.wav
  video/*.webm                      video sessions only, labelled compressed
  timeline/timeline-at-interview.json   context, not part of the encounter
  gip/README.txt                    Generative Information Package (empty)
  VERIFY.txt                        how to check it without any Sondage software
```

Check one from `desktop/`: `npm run verify -- <file>.capsule.age --identity <key file> --fellow-key "<fingerprint>" [--extract <folder>]`,
or follow `VERIFY.txt` by hand. Without `--fellow-key` or `--receipt` it reports
"verified, but not anchored".

## After a Fellow dies: heirs

In the desktop app (Help → After I die), the Fellow ticks which family helpers may open their recordings after death. Those helpers already hold a safety copy of the key.

1. The heir opens their safety email and presses "Tell Sondage that … has died". Admins are emailed, and so is the Fellow's own address, in case it isn't true.
2. An admin checks (obituary or certificate, a call with the family), writes how they checked, and presses Confirm on the Fellow's profile. Sondage makes an heir account and emails a password link and instructions.
3. After the waiting period (`INHERITANCE_WAIT_DAYS`, 14 in production), the heir signs into the Sondage app, points it at the Fellow's recordings folder (copied from their computer or a backup) and presses "Ask for the key". They confirm from their safety email; an admin calls them and releases Sondage's copy.
4. Sondage releases only the **unlocking half** of its copy, and only the heir's own piece is used (other helpers can still stop the request). Together they rebuild just the key that opens capsules, on the heir's computer, checked against the Fellow's registered one. The signing key is never rebuilt, even briefly: the heir can check and play the recordings, never sign as the Fellow.

Tested end to end in `e2e/e2e-heir.mjs` (run after `e2e-call.mjs` on the same server) and in `web/test/integration/inheritance_test.rb`.

## Journal and matching

**Journal.** Fellows write or record a voice note any time, in the desktop app (My journal) or on the web. Entries are private unless the Fellow ticks "Let my historian read this"; admins and historians only ever see shared entries, and voice notes are served only to allowed readers (no public links). Historians and admins can leave questions; answering one shares it by default, and "Not now" sets it aside. Unlike the sealed interview, journal entries can be changed or deleted.

**Matching.** A Fellow chooses up to three historians from their profiles; historians see Fellows who are looking (first name, birth decade, hometown, and the Fellow's own short introduction only) and choose the ones they'd like to work with. When both sides choose each other, admins are emailed, call the Fellow, and press Confirm on the Matching page. Admins can also set a historian directly on a Fellow's profile. Once matched, the historian can open the Fellow's profile, timeline and shared journal entries.

Extra demo accounts: `historian2@sondage.test` (Grace Whitfield, who has chosen Walter), `historian3@sondage.test`, and `walter@sondage.test` (a Fellow still looking). Same password.

Tests: `web/test/integration/journal_and_matching_test.rb`, and `e2e/e2e-journal.mjs` for the desktop app.

## Interviews in parts

An interview can be several shorter sessions. "Schedule part 2" on the Fellow's profile adds the next one; each part is recorded and sealed on its own, so a saved part never changes.

## Calls between homes: the relay

Most home routers block direct connections between two homes, so production needs a TURN relay. It forwards the encrypted call and can't see or hear it.

1. On a small server with a public IP, put `deploy/coturn/turnserver.conf` (edit the names, IP and secret) and run `docker compose up -d` from `deploy/coturn`.
2. Open UDP/TCP 3478, TCP 5349 and UDP 49152–65535.
3. Give the Rails app: `TURN_URLS=turn:relay.example.org:3478?transport=udp,turn:relay.example.org:3478?transport=tcp,turns:relay.example.org:5349?transport=tcp` and `TURN_SECRET=<same secret>`.
4. Optional `TURN_ONLY=1`: always use the relay, so the two homes never learn each other's internet address.

Rails gives each person a fresh 12-hour relay password (`app/models/call_relay.rb`). The historian's page says "through the Sondage relay" when it's in use. Tested end to end with coturn: `RELAY=1 node e2e/server.mjs`, then `node e2e/e2e-call.mjs`.

## Photographs and type

The apps use photographs from sondagestandard.com. Download them once with `bash scripts/fetch-photos.sh` (the apps show a plain tone until then), then commit them. The desktop app bundles the same typefaces as the website, Cormorant Garamond and Manrope (SIL Open Font License), so it looks the same offline. One portrait on the commission page (Dora Diamantová) has "AI" in its file name and looks AI-colorized; it's left out, given the no-AI promise.

## What was tested, and what wasn't (in detail)

- **Sealing, encryption and verification** (`desktop/test`): 6 automated tests passing before the hardening changes, plus new ones for the split safety copies, anchored verification and the seal record (not yet run). They cover recording, signing, sealing, opening only with the Fellow's key, detecting a single changed audio sample, detecting an edited manifest, refusing a forged historian signature, out-of-order and replaced chunks, recovery shares, and chunk transfer surviving a dropped connection.
- **The whole journey, end to end** (`e2e/`): passing. A Fellow sets up safety copies, joins a video interview that the historian starts and stops, and the recording is saved, checked and played back in the app. Then the computer is "lost": a second, empty copy of the app gets the key back when the Fellow and Sondage approve, and opens the same recording.
- **The interview itself:** passing for audio and for video interviews. The Electron app and the historian's page in Chrome connect peer to peer and record raw 32-bit float audio on both sides; the historian's chunks travel straight to the Fellow's app. The historian's browser checks the manifest byte for byte before co-signing, then the capsule is sealed, encrypted, and verified both from the app and from the command line.
- **The Rails app was not booted.** The sandbox it was built in couldn't reach rubygems.org, so `bundle install` was impossible. Every Ruby and ERB file passes a syntax check, and its JavaScript and CSS (timeline, historian room) were exercised by the end-to-end test through a stand-in server. The Rails tests in `web/test` (including sign-in, receipts, the call channel and the safety-copy flow) are written but haven't been run. **Run `bin/setup` and `bin/rails test` first, and expect some small fixes.**
- **Trusted timestamps** weren't reachable from the sandbox. The request format was validated with OpenSSL, and the app seals without certification (and says so) when the service is down.
- **The hardening changes** (live witnessing, the recovery gate, split safety copies, the seal record, anchored verification, the strict page policy, OPFS storage in the historian's browser, the room checklist) were written without being able to install dependencies or run anything, so none of them has run yet. Tests for them are in `desktop/test`, `web/test/integration` and `e2e/`. CI (`.github/workflows/ci.yml`) runs all of it; **expect a round of small fixes the first time it runs.**

## Before this goes in front of a Fellow (full list)

- **Boot and test the Rails app.** See above.
- **TURN server.** Without one (coturn, via `TURN_URL`, `TURN_USERNAME`, `TURN_PASSWORD`), calls between some home networks won't connect.
- **Signing certificates.** Installers build and publish today, but unsigned. Add an Apple Developer ID and a Windows code-signing certificate (see [Releasing the desktop app](#releasing-the-desktop-app)) so they open without warnings.
- **The historian's browser** now keeps unsent chunks in its private file storage (OPFS) until the Fellow's app confirms them, and sends them again after a reload. Browsers without OPFS fall back to memory, as before.
- **Timestamp authority:** choose one for production and record its CA certificate alongside the verifier.
- **Safety copies:** replacing a helper later needs a new key for future recordings (older recordings keep the old one). There's no key history yet; build one (in the account and in each capsule's manifest) before the first rotation, so older capsules still verify against an outside record. Sondage should confirm that holding one of four copies, and being required for every recovery, fits "Sondage retains no keys".
- **Copies made before the split** (65-byte shares) still restore, but can't be halved, so an heir would receive the signing key too. The admin page says so. Existing Fellows need new copies (and new safety emails) to get the split.
- **The Fellow's own safety copy** still goes to their own inbox. The recovery gate makes that safe against an inbox takeover alone, but a printed copy, or a second address, would be better still.
- **The Fellow's web pages** (intake questions, 10x10 lists, adding to the timeline) have bigger text and plainer words on the home page, but deserve the same one-step-per-screen redesign as the desktop app.
- **Video files** from the browser recorder lack a duration header; most players cope, but archival copies should be remuxed (without re-encoding) at sealing.
- **Linux without a keychain** falls back to a file readable only by the user. The app says so.
- **Identity verification** at onboarding, human transcription as a later version beside the sealed originals, and encrypted upload to storage the Fellow chooses are designed but not built.
- **Questions for Sondage:** whether an encrypted cloud copy nobody else can read satisfies Non-Custodial Sovereignty, whether holding one of four safety copies (and gating every recovery) satisfies "retains no keys", and whether compressed video is acceptable alongside the uncompressed audio. Get these answered in writing; they decide the architecture.
- **Test with two or three real Fellows** before building more, especially safety-copy setup: three contacts, sending emails and understanding why is where people will drop off.
- **Hardware processing:** a one-time check that plays a test tone and records it would catch some OS or headset processing the browser can't report. Not built.
