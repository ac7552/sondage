// End-to-end: the Fellow's journal and choosing a historian, in the desktop app.
//   1. Answer the historian's question in writing (shared), write a private entry
//      with a voice recording, play it back, change it, delete it, set a question aside.
//   2. Choose historians (one of whom already chose the Fellow), take one back,
//      write an introduction, and see the confirmed match.
import { _electron as electron } from "playwright-core";
import fs from "node:fs";
import path from "node:path";

const SP = path.dirname(new URL(import.meta.url).pathname);
const OUT = path.join(SP, "out");
fs.mkdirSync(OUT, { recursive: true });
const DESK = path.resolve(SP, "../desktop");
const userData = path.join(OUT, "journal-userdata");
fs.rmSync(userData, { recursive: true, force: true });
const shot = (page, name) => page.screenshot({ path: path.join(OUT, `journal-${name}.png`) });
const step = (m) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);
const fail = (m) => { throw new Error(m); };

const app = await electron.launch({
  executablePath: path.join(DESK, "node_modules/electron/dist/electron"),
  args: [DESK, "--no-sandbox"],
  env: { ...process.env, SONDAGE_USER_DATA: userData, SONDAGE_FAKE_MEDIA: "1", SONDAGE_SERVER_URL: "http://localhost:3999", SONDAGE_VAULT_DIR: path.join(OUT, "journal-vault"), SONDAGE_TSA_URL: "", SONDAGE_MAIL_LOG: path.join(OUT, "journal-mail.log") },
});
const win = await app.firstWindow();
win.on("pageerror", (e) => console.log("PAGEERROR", e.message));
win.on("console", (m) => m.type() === "error" && !/favicon/.test(m.text()) && console.log("CONSOLE", m.text()));
win.on("dialog", (d) => { step(`dialog: ${d.message().split("\n")[0]}`); d.accept(); });
await win.setViewportSize({ width: 1280, height: 900 }).catch(() => {});

// sign in and get through the one-time safety setup quickly
await win.waitForSelector("#view-signin:not([hidden])");
await win.fill('#signin-form [name="email"]', "eleanor@sondage.test");
await win.fill('#signin-form [name="password"]', "sondage-demo-2026");
await win.click('#signin-form button[type="submit"]');
await win.click('.step[data-step="intro"] [data-next]');
await win.click('.step[data-step="you"] [data-next]');
for (const [n, name, email] of [[1, "Ana Ruiz", "ana@example.com"], [2, "Marco Ruiz", "marco@example.com"]]) {
  await win.fill(`form[data-helper="${n}"] [name="name"]`, name);
  await win.fill(`form[data-helper="${n}"] [name="email"]`, email);
  await win.click(`form[data-helper="${n}"] button[type="submit"]`);
}
for (let i = 0; i < 3; i++) {
  await win.waitForSelector('.step[data-step="send"]:not([hidden])');
  await win.click("#send-open");
  await win.click("#send-yes");
}
await win.click("#setup-finish");
await win.waitForSelector("#view-home:not([hidden]) [data-go='journal']");
await shot(win, "1-home");
step("home: " + (await win.textContent("#home-card")).replace(/\s+/g, " ").trim().slice(0, 220));

// ---------------------------------------------------------------- journal
await win.click("#home-card [data-go='journal']");
await win.waitForSelector("#view-journal:not([hidden]) .sticky");
await shot(win, "2-journal");
step(`journal open with ${await win.locator(".sticky").count()} questions waiting`);

await win.click(".sticky [data-answer]");
await win.waitForSelector("#view-write:not([hidden])");
if (!(await win.isChecked("#write-share"))) fail("answering the historian's question should default to sharing");
await win.fill("#write-body", "Arroz con gandules, always, and pernil if Papi had been paid.");
await win.selectOption("#write-era", { label: /Childhood in Ponce/ }).catch(async () => win.selectOption("#write-era", { index: 1 }));
await shot(win, "3-answer");
await win.click("#write-save");
await win.waitForSelector("#view-journal:not([hidden]) .page-entry");
step(`answered a question; questions still waiting: ${await win.locator(".sticky").count()}`);

await win.click("#journal-new");
await win.waitForSelector("#view-write:not([hidden])");
if (await win.isChecked("#write-share")) fail("a new entry should be private by default");
await win.fill("#write-body", "I found Luis's old bakery apron today.");
await win.click("#voice-start");
await win.waitForSelector("#voice-live:not([hidden])");
await win.waitForTimeout(3000);
await shot(win, "4-recording-voice");
await win.click("#voice-stop");
await win.waitForSelector("#voice-done:not([hidden])");
const previewOk = await win.$eval("#voice-preview", (a) => !!a.src);
step(`voice recorded (preview ready: ${previewOk})`);
await shot(win, "5-voice-done");
await win.click("#write-save");
await win.waitForSelector("#view-journal:not([hidden]) [data-play]");
await shot(win, "6-entries");
const tags = await win.$$eval(".page-entry .page-date span", (els) => els.map((e) => e.textContent));
step("entries: " + tags.join(" | "));

await win.click(".page-entry [data-play]");
await win.waitForSelector(".page-entry audio");
await win.waitForTimeout(1500);
const played = await win.$eval(".page-entry audio", (a) => ({ t: a.currentTime, d: a.duration, err: a.error?.code || null }));
step(`played the voice note back: ${played.t.toFixed(1)}s played${played.err ? `, error ${played.err}` : ""}`);
if (played.err) fail("voice note didn't play");

// change the private entry
await win.click(".page-entry:first-child [data-edit]");
await win.waitForSelector("#view-write:not([hidden])");
await win.fill("#write-body", "I found Luis's old bakery apron today. It still smells a little like anise.");
await win.click("#write-save");
await win.waitForSelector("#view-journal:not([hidden]) .page-entry");
if (!/anise/.test(await win.textContent("#journal-entries"))) fail("change wasn't saved");
step("changed an entry");

// set the other question aside, then delete an entry
await win.click(".sticky [data-dismiss]");
await win.waitForFunction(() => document.querySelectorAll(".sticky").length === 0);
step("set the second question aside");
const before = await win.locator(".page-entry").count();
await win.click(".page-entry:last-child [data-delete]");
await win.waitForFunction((n) => document.querySelectorAll(".page-entry").length === n - 1, before);
step(`deleted an entry (${before} → ${before - 1})`);
await shot(win, "7-after-delete");

// ---------------------------------------------------------------- choosing a historian
await win.click('#nav [data-go="home"]');
await win.click("#home-card [data-go='historians']");
await win.waitForSelector("#view-historians:not([hidden]) .hist-card");
await shot(win, "8-historians");
step(`historians: ${(await win.$$eval(".hist-card h3", (e) => e.map((x) => x.textContent))).join(", ")}`);
await win.click('.hist-card [data-choose="4"]');
await win.waitForSelector('.hist-card [data-unchoose="4"]');
await win.click('.hist-card [data-choose="2"]'); // Dr. Reyes already chose Eleanor: mutual
await win.waitForSelector('.hist-card [data-unchoose="2"]');
step("stepcount: " + (await win.textContent("#hist-body .stepcount")));
await win.click('.hist-card [data-unchoose="4"]');
await win.waitForSelector('.hist-card [data-choose="4"]');
step("took back a choice: " + (await win.textContent("#hist-body .stepcount")));
await win.click("details.about-me summary");
await win.fill('#intro-form [name="intro"]', "I grew up in Ponce and ran a bakery in the Bronx for thirty years.");
await win.fill('#intro-form [name="languages"]', "Spanish, English");
await win.click('#intro-form button[type="submit"]');
await win.waitForSelector("#intro-saved:not([hidden])");
await shot(win, "9-chosen");
step("introduction saved");

await fetch("http://localhost:3999/test/confirm-match", { method: "POST" });
await win.click('#nav [data-go="home"]');
await win.waitForSelector("#view-home:not([hidden]) [data-go='journal']");
if (await win.$("#home-card [data-go='historians']")) fail("home should stop asking once matched");
await win.click('#nav [data-go="journal"]');
await win.waitForSelector("#view-journal:not([hidden]) .page-entry");
await win.click("#journal-new");
step("share label after the match: " + (await win.textContent("#write-share-label")));
await win.click("#write-cancel");
await shot(win, "10-journal-final");
await app.close();
step("done");
