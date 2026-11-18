// End to end, the first version (Sondage Resounder), as it would happen:
//   The Senior Fellow signs in and presses Connect. The Scholar joins from the browser.
//   They talk; recording runs throughout. The Scholar presses Stop. The two-channel
//   master and Sitting record are filed on the Fellow's desktop under Stephen's names,
//   the Sondage server is told (for the confirming email), and the Scholar's copy is
//   deleted.
//
// Run the stand-in server with every extra feature off and a short Sitting:
//   SONDAGE_FEATURES= SITTING_MINUTES=1 node server.mjs &
//   node e2e-sitting.mjs            (RECORD_SECONDS=25 by default)
import { _electron as electron, chromium } from "playwright-core";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const SP = path.dirname(new URL(import.meta.url).pathname);
const OUT = path.join(SP, "out");
const DESK = path.resolve(SP, "../desktop");
const RECORD_SECONDS = +(process.env.RECORD_SECONDS || 25);
const archive = path.join(OUT, "sitting-desktop", "vault");
const userData = path.join(OUT, "sitting-userdata");
for (const p of [path.join(OUT, "sitting-desktop"), userData]) fs.rmSync(p, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
const shot = (page, name) => page.screenshot({ path: path.join(OUT, `sitting-${name}.png`) });
const step = (m) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);
const fail = (m) => { throw new Error(m); };

// ---------------------------------------------------------------- the Senior Fellow signs in
const app = await electron.launch({
  executablePath: path.join(DESK, "node_modules/electron/dist/electron"),
  args: [DESK, "--no-sandbox"],
  env: { ...process.env, SONDAGE_USER_DATA: userData, SONDAGE_FAKE_MEDIA: "1", SONDAGE_SERVER_URL: "http://localhost:3999", SONDAGE_ARCHIVE_DIR: archive, SONDAGE_TSA_URL: "" },
});
const win = await app.firstWindow();
win.on("pageerror", (e) => console.log("FELLOW PAGEERROR", e.message));
win.on("console", (m) => !/favicon/.test(m.text()) && (m.type() === "error" || process.env.VERBOSE) && console.log("FELLOW", m.type(), m.text()));
win.on("dialog", (d) => d.accept());
await win.setViewportSize({ width: 1280, height: 860 }).catch(() => {});
await win.waitForSelector("#view-signin:not([hidden])");
await win.fill('#signin-form [name="email"]', "eleanor@sondage.test");
await win.fill('#signin-form [name="password"]', "sondage-demo-2026");
await shot(win, "1-signin");
await win.click('#signin-form button[type="submit"]');
// With a Dropbox app configured, a new computer first asks where Sittings are kept.
await win.waitForSelector("#view-storage:not([hidden]) #storage-connect, #view-home:not([hidden]) [data-join]", { timeout: 20000 });
if (await win.isVisible("#storage-connect")) {
  step("storage setup: " + (await win.textContent("#storage-list")).replace(/\s+/g, " ").trim());
  await shot(win, "1b-storage");
  await win.click("#storage-skip"); // a real setup presses Connect my Dropbox
  step("skipped Dropbox for this test");
}
await win.waitForSelector("#view-home:not([hidden]) [data-join]", { timeout: 20000 });
step("home: " + (await win.textContent("#home-card")).replace(/\s+/g, " ").trim());
const navShown = await win.$$eval("#nav [data-go]", (els) => els.filter((e) => !e.hidden).map((e) => e.textContent.trim()));
step("nav shows: " + navShown.join(", "));
if (navShown.some((t) => /journal|life story|recordings/i.test(t))) fail("switched-off features are still in the menu");
if (!(await win.textContent("#home-card [data-join]")).includes("Connect")) fail("the home screen should offer Connect");
await shot(win, "2-home");

// ---------------------------------------------------------------- the Scholar opens the room
const chrome = await chromium.launch({ executablePath: process.env.CHROME || "/usr/bin/google-chrome", args: ["--no-sandbox", "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required"] });
const hctx = await chrome.newContext({ viewport: { width: 1360, height: 860 }, permissions: ["microphone", "camera"] });
const hist = await hctx.newPage();
hist.on("pageerror", (e) => console.log("SCHOLAR PAGEERROR", e.message));
hist.on("dialog", (d) => d.accept());
await hist.goto("http://localhost:3999/room");
await hist.waitForFunction(() => document.getElementById("key-status").textContent.startsWith("Your signing key"), null, { timeout: 15000 });
if (await hist.$("#room-checklist")) fail("the room checklist should be switched off");
await hist.check("#headphones");
await hist.waitForFunction(() => !document.getElementById("join").disabled, null, { timeout: 10000 });
await hist.click("#join");
step("Scholar is in the room");

// ---------------------------------------------------------------- one click: Connect
await win.click("#home-card [data-join]");
await win.waitForSelector("#view-room:not([hidden])", { state: "attached" });
await win.waitForFunction(() => document.getElementById("rec-banner").textContent === "Recording", null, { timeout: 30000 });
step("connected, and recording started by itself");
await hist.waitForFunction(() => /Recording/.test(document.getElementById("rec-state").textContent), null, { timeout: 15000 });
if (!(await hist.isHidden("#h-start"))) fail("the Scholar shouldn't need a Start recording button");
const countdown = await win.textContent("#timer");
step(`countdown on the Fellow's screen: ${countdown}; on the Scholar's: ${await hist.textContent("#timer")}`);
if (!/^0:5\d$|^1:00$/.test(countdown)) fail(`expected a one-minute countdown, saw ${countdown}`);
await win.waitForTimeout(2500);
await shot(win, "3-sitting");
await shot(hist, "3-scholar");

await win.waitForTimeout(RECORD_SECONDS * 1000);
step(`after ${RECORD_SECONDS}s: "${await win.textContent("#room-status")}"; countdown ${await win.textContent("#timer")}`);

// ---------------------------------------------------------------- the Scholar presses Stop
if ((await hist.textContent("#h-end")).trim() !== "Stop") fail("the Scholar's button should say Stop");
await hist.click("#h-end");
await win.waitForFunction(() => /Your Sitting is saved|We need a little help/.test(document.getElementById("seal-title").textContent), null, { timeout: 120000 });
const err = await win.$eval("#seal-error", (e) => (e.hidden ? null : e.textContent));
await shot(win, "4-saved");
if (err) fail("delivery failed: " + err);
step("saved: " + (await win.textContent("#seal-lede")));
step("steps: " + (await win.$$eval("#seal-steps li", (lis) => lis.map((l) => `${l.dataset.label} [${l.className}] ${l.querySelector(".say").textContent}`).join(" | "))));

// ---------------------------------------------------------------- the files, by Stephen's names
const dir = path.join(archive, "sondage-archive/2027-ruiz-eleanor/v1/content/03-sittings/sitting-03");
const files = fs.readdirSync(dir).sort();
step("filed: " + path.relative(path.join(OUT, "sitting-desktop"), dir) + "/ " + files.join(", "));
const today = new Date();
const day = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
const masterName = `2027-ruiz-eleanor_sitting-03_master_${day}.wav`;
const recordName = `2027-ruiz-eleanor_sitting-03_sitting-record_${day}.json`;
if (JSON.stringify(files) !== JSON.stringify([masterName, recordName].sort())) fail(`unexpected files: ${files}`);

const wav = fs.readFileSync(path.join(dir, masterName));
const record = JSON.parse(fs.readFileSync(path.join(dir, recordName), "utf8"));
const sha = crypto.createHash("sha512").update(wav).digest("hex");
if (record.sha512 !== sha) fail("the Sitting record's SHA-512 doesn't match the master");
const fmt = wav.readUInt16LE(20), channels = wav.readUInt16LE(22), rate = wav.readUInt32LE(24), bits = wav.readUInt16LE(34);
const dataBytes = wav.readUInt32LE(54);
const samples = new Float32Array(wav.buffer.slice(wav.byteOffset + 58, wav.byteOffset + 58 + dataBytes));
const rms = (ch) => { let s = 0, n = 0; for (let i = ch; i < samples.length; i += 2) { s += samples[i] * samples[i]; n++; } return Math.sqrt(s / n); };
const seconds = samples.length / 2 / rate;
step(`master: ${fmt === 3 ? "float" : fmt}, ${bits}-bit, ${channels} channels, ${rate} Hz, ${seconds.toFixed(1)}s; left (Senior Fellow) RMS ${rms(0).toFixed(4)}, right (Scholar) RMS ${rms(1).toFixed(4)}`);
if (fmt !== 3 || bits !== 32 || channels !== 2) fail("the master should be 32-bit float, two channels");
if (!(rms(0) > 0.001 && rms(1) > 0.001)) fail("both voices should be in the master");
if (Math.abs(seconds - record.duration_seconds) > 0.01) fail("the record's duration doesn't match");
step("record: " + JSON.stringify({ started_at: record.started_at, ended_at: record.ended_at, duration_seconds: record.duration_seconds, channels: record.channels }));

// Nothing left behind on the Fellow's side but the filed copy; no video kept.
const staging = path.join(userData, "staging");
const left = fs.existsSync(staging) ? fs.readdirSync(staging) : [];
if (left.length) fail(`staging wasn't cleaned up: ${left}`);
if (fs.readdirSync(dir).some((f) => /webm/.test(f))) fail("video should not be recorded");

// ---------------------------------------------------------------- the server, and the Scholar's copy
const reported = await (await fetch("http://localhost:3999/test/sittings")).json();
if (reported.sittings.length !== 1) fail(`expected one Sitting reported for the email, got ${reported.sittings.length}`);
step(`server told (for the confirming email): ${reported.sittings[0].started_at} to ${reported.sittings[0].ended_at}`);

await hist.waitForSelector("#done:not([hidden])", { timeout: 20000 });
step("Scholar's page: " + (await hist.textContent("#done h1")) + " " + (await hist.textContent("#done .lede")));
const leftover = await hist.evaluate(async () => {
  const root = await navigator.storage.getDirectory();
  const names = [];
  for await (const [name] of root.entries()) names.push(name);
  return names;
});
if (leftover.length) fail(`the Scholar's browser still holds: ${leftover}`);
step("the Scholar's browser holds nothing");
await shot(hist, "5-scholar-done");

await win.click("#seal-home");
await win.waitForSelector("#view-home:not([hidden]) .feature");
step("home afterwards: " + (await win.textContent("#home-card")).replace(/\s+/g, " ").trim());
await shot(win, "6-home-after");

await app.close();
await chrome.close();
step("done");
