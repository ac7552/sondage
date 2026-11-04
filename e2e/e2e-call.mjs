// End-to-end, as a Fellow and a historian would do it:
//   1. Fellow sets up safety copies (themselves + two helpers), one simple step at a time.
//   2. Interview: Electron (Fellow) + Chrome (historian), synthetic camera and microphone,
//      real peer-to-peer call; the historian starts and ends the recording.
//   3. The capsule is sealed, checked, and played back in the app.
//   4. "Lost computer": a second, empty Electron app gets the key back when the Fellow
//      and Sondage approve, and opens the same capsule.
import { _electron as electron, chromium } from "playwright-core";
import fs from "node:fs";
import path from "node:path";

const SP = path.dirname(new URL(import.meta.url).pathname);
const OUT = path.join(SP, "out");
fs.mkdirSync(OUT, { recursive: true });
const DESK = path.resolve(SP, "../desktop");
const RECORD_SECONDS = +(process.env.RECORD_SECONDS || 15);
const vault = path.join(OUT, "vault");
const mailLog = path.join(OUT, "mail.log");
for (const p of [vault, mailLog, path.join(OUT, "fellow-userdata"), path.join(OUT, "fellow-userdata-2")]) fs.rmSync(p, { recursive: true, force: true });
const shot = (page, name) => page.screenshot({ path: path.join(OUT, `call-${name}.png`) });
const step = (m) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);

async function launchFellow(userDir) {
  const app = await electron.launch({
    executablePath: path.join(DESK, "node_modules/electron/dist/electron"),
    args: [DESK, "--no-sandbox"],
    env: { ...process.env, SONDAGE_USER_DATA: path.join(OUT, userDir), SONDAGE_FAKE_MEDIA: "1", SONDAGE_SERVER_URL: "http://localhost:3999", SONDAGE_VAULT_DIR: vault, SONDAGE_TSA_URL: process.env.TSA ?? "", SONDAGE_MAIL_LOG: mailLog },
  });
  const win = await app.firstWindow();
  win.on("pageerror", (e) => console.log("FELLOW PAGEERROR", e.message));
  win.on("console", (m) => m.type() === "error" && !/favicon/.test(m.text()) && console.log("FELLOW", m.text()));
  win.on("dialog", (d) => d.accept());
  await win.setViewportSize({ width: 1280, height: 860 }).catch(() => {});
  await win.waitForSelector("#view-signin:not([hidden])");
  await win.fill('#signin-form [name="email"]', "eleanor@sondage.test");
  await win.fill('#signin-form [name="password"]', "sondage-demo-2026");
  await win.click('#signin-form button[type="submit"]');
  return { app, win };
}

// ---------------------------------------------------------------- 1. setup
const { app, win } = await launchFellow("fellow-userdata");
await shot(win, "f1-signin");
await win.waitForSelector('#view-setup:not([hidden]) .step[data-step="intro"]:not([hidden])');
step("fellow signed in; setup starts");
await shot(win, "f2-setup-intro");
await win.click('.step[data-step="intro"] [data-next]');
await win.waitForSelector('.step[data-step="you"]:not([hidden])');
await shot(win, "f3-setup-you");
await win.click('.step[data-step="you"] [data-next]');
await win.fill('form[data-helper="1"] [name="name"]', "Ana Ruiz");
await win.fill('form[data-helper="1"] [name="email"]', "ana@example.com");
await shot(win, "f4-setup-helper");
await win.click('form[data-helper="1"] button[type="submit"]');
await win.fill('form[data-helper="2"] [name="name"]', "Marco Ruiz");
await win.fill('form[data-helper="2"] [name="email"]', "marco@example.com");
await win.click('form[data-helper="2"] button[type="submit"]');
for (let i = 0; i < 3; i++) {
  await win.waitForSelector('.step[data-step="send"]:not([hidden])');
  if (i === 0) await shot(win, "f5-setup-send");
  await win.click("#send-open");
  await win.waitForSelector("#send-check:not([hidden])");
  await win.click("#send-yes");
}
await win.waitForSelector('.step[data-step="done"]:not([hidden])');
await shot(win, "f6-setup-done");
const mails = fs.readFileSync(mailLog, "utf8").trim().split("\n").map((l) => JSON.parse(l));
step(`safety emails written: ${mails.map((m) => `${m.to} (${m.role})`).join(", ")}`);
await win.click("#setup-finish");
await win.waitForSelector("#view-home:not([hidden]) [data-join]");
await shot(win, "f7-home");
await win.click('#home-card [data-go="story"]');
await win.waitForSelector("#view-story:not([hidden]) .tl-world", { timeout: 15000 });
await win.waitForTimeout(800);
await shot(win, "f7b-story");
await win.evaluate(() => scrollTo(0, innerHeight * 3.6));
await win.waitForTimeout(900);
await shot(win, "f7c-story-chapter");
await win.click('.card.k-photo:not([style*="hidden"])', { force: true }).catch(() => {});
await win.waitForTimeout(500);
await shot(win, "f7d-story-item");
await win.keyboard.press("Escape");
step("life story shown in the desktop app");
await win.evaluate(() => scrollTo(0, 0));
await win.click('#nav [data-go="home"]');
await win.waitForSelector("#view-home:not([hidden]) [data-join]");
step("home: " + (await win.textContent("#home-card")).replace(/\s+/g, " ").trim());

// ---------------------------------------------------------------- 2. interview
const chrome = await chromium.launch({ executablePath: process.env.CHROME || "/usr/bin/google-chrome", args: ["--no-sandbox", "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required"] });
const hctx = await chrome.newContext({ viewport: { width: 1360, height: 860 }, permissions: ["microphone", "camera"] });
const hist = await hctx.newPage();
hist.on("pageerror", (e) => console.log("HISTORIAN PAGEERROR", e.message));
hist.on("dialog", (d) => d.accept());
await hist.goto("http://localhost:3999/room");
await hist.waitForFunction(() => document.getElementById("key-status").textContent.startsWith("Your signing key"), null, { timeout: 15000 });
await hist.check("#headphones");
await hist.waitForFunction(() => !document.getElementById("join").disabled, null, { timeout: 10000 });
await hist.click("#join");
step("historian is in the room");

await win.click("[data-join]");
await win.waitForSelector('#view-check:not([hidden]) .step[data-check="headphones"]:not([hidden])');
await shot(win, "f8-headphones");
await win.click("[data-check-next]");
await win.waitForSelector('.step[data-check="mic"]:not([hidden])');
await win.waitForTimeout(1500);
await shot(win, "f9-say-hello");
await win.click("#mic-yes");
await win.waitForSelector("#view-room:not([hidden]) .console");
await win.waitForFunction(() => document.getElementById("room-status").textContent.startsWith("You are talking"), null, { timeout: 30000 });
await hist.waitForFunction(() => !document.getElementById("h-start").disabled, null, { timeout: 15000 });
step("connected; fellow sees: " + (await win.textContent("#room-status")));
await shot(win, "f10-room-before");

await hist.click("#h-start");
await win.waitForFunction(() => document.getElementById("rec-banner").classList.contains("on"), null, { timeout: 15000 });
step(`historian started the recording; recording ${RECORD_SECONDS}s`);
await win.waitForTimeout(11000);
// The Fellow leaves in the middle and comes back: nothing is overwritten, and the
// recording picks up again by itself because the interviewer is still recording.
await win.click("#leave-room");
await win.waitForSelector("#view-home:not([hidden]) [data-join]");
step("fellow left mid-recording and is back on the home page");
await win.click("[data-join]");
await win.click("[data-check-next]");
await win.click("#mic-yes");
await win.waitForFunction(() => document.getElementById("rec-banner").classList.contains("on"), null, { timeout: 30000 });
step("fellow rejoined; recording resumed by itself");
await win.waitForTimeout(RECORD_SECONDS * 1000);
await shot(win, "f11-recording");
await shot(hist, "h1-recording");
step("historian: " + (await hist.textContent("#sent")));

await hist.click("#h-end");
await hist.waitForSelector("#sign:not([hidden])", { timeout: 60000 });
await shot(hist, "h2-sign");
await hist.click("#sign-yes");
await win.waitForFunction(() => document.getElementById("seal-title").textContent.startsWith("Your recording is saved") || !document.getElementById("seal-error").hidden, null, { timeout: 90000 });
const err = await win.$eval("#seal-error", (e) => (e.hidden ? null : e.textContent));
await shot(win, "f12-saved");
if (err) throw new Error("SEAL FAILED: " + err);
step("saved: " + (await win.textContent("#seal-title")));
await hist.waitForSelector("#done:not([hidden])", { timeout: 15000 });

// ---------------------------------------------------------------- 3. check and listen
await win.click("#seal-home");
await win.waitForSelector("#view-vault:not([hidden]) .capsule-card");
await win.click("#view-vault [data-verify]");
await win.waitForFunction(() => !/Checking/.test(document.querySelector("#view-vault .check-result").textContent), null, { timeout: 60000 });
step("check: " + (await win.textContent("#view-vault .check-result")));
await shot(win, "f13-recordings");
await win.click("#view-vault [data-listen]");
await win.waitForFunction(() => document.querySelectorAll("#listen-media audio").length > 0, null, { timeout: 60000 });
await win.click("#play");
await win.waitForTimeout(2500);
const played = await win.$$eval("#listen-media audio, #listen-media video", (els) => els.map((m) => `${m.tagName.toLowerCase()} ${m.currentTime.toFixed(1)}s/${(m.duration || 0).toFixed(1)}s`));
step("listening at the start: " + played.join(", "));
await win.$eval("#seek", (el) => { el.value = 700; el.dispatchEvent(new Event("input")); });
await win.waitForTimeout(1500);
step("listening 70% in: " + (await win.$$eval("#listen-media audio", (els) => els.map((m) => `${m.paused ? "waiting" : "playing"} at ${m.currentTime.toFixed(1)}s (starts ${(+m.dataset.offset).toFixed(1)}s)`))).join(", "));
await shot(win, "f14-listen");
await app.close();
await hctx.close();

// ---------------------------------------------------------------- 4. lost computer
step("--- a new computer with no key ---");
const b = await launchFellow("fellow-userdata-2");
await b.win.waitForSelector("#view-restore:not([hidden])");
await shot(b.win, "r1-welcome-back");
await b.win.click("#restore-ask");
await b.win.waitForSelector("#restore-progress:not([hidden]) .people li");
await shot(b.win, "r2-waiting");

const self = mails.find((m) => m.role === "self");
const page = await (await chrome.newContext({ viewport: { width: 1100, height: 860 } })).newPage();
page.on("pageerror", (e) => console.log("SAFETY PAGEERROR", e.message));
await page.goto(self.link);
await page.waitForSelector("#s-actions:not([hidden])", { timeout: 15000 });
await page.screenshot({ path: path.join(OUT, "call-r3-safety-page.png") });
step("safety page: " + (await page.textContent("#s-title")));
await page.click("#s-yes");
await page.waitForFunction(() => document.getElementById("s-title").textContent === "Thank you", null, { timeout: 15000 });
step("Fellow approved from their own safety email");
await b.win.waitForFunction(() => /1 person has clicked/.test(document.getElementById("restore-lede").textContent), null, { timeout: 20000 });
await shot(b.win, "r4-one-in");
await fetch("http://localhost:3999/test/release", { method: "POST" }); // an admin, after phoning the Fellow
step("Sondage released its copy");
await b.win.waitForSelector("#view-home:not([hidden]) [data-join], #view-home:not([hidden]) .card", { timeout: 30000 });
step("new computer has the key back");
await b.win.click('[data-go="vault"]');
await b.win.waitForSelector("#view-vault:not([hidden]) .capsule-card");
await b.win.click("#view-vault [data-verify]");
await b.win.waitForFunction(() => !/Checking/.test(document.querySelector("#view-vault .check-result").textContent), null, { timeout: 60000 });
step("old recording on the new computer: " + (await b.win.textContent("#view-vault .check-result")));
await shot(b.win, "r5-recordings");
await b.app.close();
await chrome.close();
