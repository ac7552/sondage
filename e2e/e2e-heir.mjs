// End-to-end, after e2e-call.mjs on the same server: what happens after a Fellow dies.
//   1. Eleanor chooses Ana (a family helper) to receive her recordings.
//   2. Ana reports Eleanor's death from her safety email; Sondage confirms it.
//   3. Ana signs into the Sondage app on her own computer, points it at Eleanor's
//      recordings, asks for the key, approves from her safety email; Sondage releases.
//   4. Ana's computer checks and plays Eleanor's sealed interview. It can't sign as her.
import { _electron as electron, chromium } from "playwright-core";
import fs from "node:fs";
import path from "node:path";

const SP = path.dirname(new URL(import.meta.url).pathname);
const OUT = path.join(SP, "out");
const DESK = path.resolve(SP, "../desktop");
const vault = path.join(OUT, "vault");
const mailLog = path.join(OUT, "mail.log");
if (!fs.existsSync(mailLog)) throw new Error("Run e2e-call.mjs first (on the same server).");
const step = (m) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);
const fail = (m) => { throw new Error(m); };

async function launch(userDir, email, password) {
  const app = await electron.launch({
    executablePath: path.join(DESK, "node_modules/electron/dist/electron"),
    args: [DESK, "--no-sandbox"],
    env: { ...process.env, SONDAGE_USER_DATA: path.join(OUT, userDir), SONDAGE_FAKE_MEDIA: "1", SONDAGE_SERVER_URL: "http://localhost:3999", SONDAGE_VAULT_DIR: vault, SONDAGE_TSA_URL: "", SONDAGE_MAIL_LOG: path.join(OUT, "heir-mail.log") },
  });
  const win = await app.firstWindow();
  win.on("pageerror", (e) => console.log("PAGEERROR", e.message));
  win.on("dialog", (d) => d.accept());
  await win.setViewportSize({ width: 1280, height: 900 }).catch(() => {});
  if (email) {
    await win.waitForSelector("#view-signin:not([hidden])");
    await win.fill('#signin-form [name="email"]', email);
    await win.fill('#signin-form [name="password"]', password);
    await win.click('#signin-form button[type="submit"]');
  }
  return { app, win };
}

// ---------------------------------------------------------------- 1. Eleanor chooses an heir
const f = await launch("fellow-userdata-2"); // the computer that got Eleanor's key back
await f.win.waitForSelector("#view-home:not([hidden])", { timeout: 20000 });
await f.win.click('#nav [data-go="settings"]');
await f.win.waitForSelector('#heirs-list input[name="heir"]');
await f.win.screenshot({ path: path.join(OUT, "heir-1-after-i-die.png") });
await f.win.check('#heirs-list label:has-text("Ana") input');
await f.win.click('#heirs-form button[type="submit"]');
await f.win.waitForSelector("#heirs-saved:not([hidden])");
step("Eleanor chose Ana to receive her recordings");
await f.app.close();

// ---------------------------------------------------------------- 2. Ana reports the death
const mails = fs.readFileSync(mailLog, "utf8").trim().split("\n").map((l) => JSON.parse(l));
const ana = mails.find((m) => m.to === "ana@example.com");
const chrome = await chromium.launch({ executablePath: process.env.CHROME || "/usr/bin/google-chrome", args: ["--no-sandbox"] });
const page = await (await chrome.newContext({ viewport: { width: 1100, height: 900 } })).newPage();
page.on("dialog", (d) => d.accept());
page.on("pageerror", (e) => console.log("SAFETY PAGEERROR", e.message));
await page.goto(ana.link);
await page.waitForSelector("#s-actions:not([hidden])");
await page.screenshot({ path: path.join(OUT, "heir-2-safety-page.png") });
step("Ana's safety page: " + (await page.textContent("#s-yes")));
await page.click("#s-yes");
await page.waitForFunction(() => document.getElementById("s-title").textContent === "Thank you");
step("Ana told Sondage; Sondage checks, then confirms");
await fetch("http://localhost:3999/test/confirm-death", { method: "POST" });

// ---------------------------------------------------------------- 3. Ana's own computer
fs.rmSync(path.join(OUT, "heir-userdata"), { recursive: true, force: true });
const h = await launch("heir-userdata", "ana@example.com", "heir-demo-2026");
await h.win.waitForSelector("#view-heir:not([hidden]) [data-heir-ask]", { timeout: 20000 });
await h.win.screenshot({ path: path.join(OUT, "heir-3-home.png") });
step("Ana's app: " + (await h.win.textContent("#heir-body .heir-steps")).replace(/\s+/g, " ").trim().slice(0, 160));
if (await h.win.isVisible('#nav [data-go="journal"]')) fail("an heir shouldn't see Eleanor's journal");
await h.win.click("[data-heir-ask]");
await h.win.waitForSelector("#view-heir .heir-steps li:nth-child(2).done");
step("Ana asked for the key");

await page.goto("about:blank");
await page.goto(ana.link);
await page.waitForSelector("#s-actions:not([hidden])");
step("Ana's safety page now: " + (await page.textContent("#s-title")));
await page.click("#s-yes");
await page.waitForFunction(() => document.getElementById("s-title").textContent === "Thank you", null, { timeout: 15000 });
await h.win.waitForSelector("#view-heir .heir-steps li:nth-child(3).done", { timeout: 20000 });
step("Ana approved from her safety email");
await h.win.screenshot({ path: path.join(OUT, "heir-4-waiting.png") });
await fetch("http://localhost:3999/test/release", { method: "POST" });
step("Sondage released its copy (after calling Ana)");
await h.win.waitForSelector('#view-heir [data-go="vault"]', { timeout: 30000 });
await h.win.screenshot({ path: path.join(OUT, "heir-5-ready.png") });
step("Ana's app: " + (await h.win.textContent("#heir-body .card")).replace(/\s+/g, " ").trim());

// ---------------------------------------------------------------- 4. open and play
await h.win.click('#view-heir [data-go="vault"]');
await h.win.waitForSelector("#view-vault:not([hidden]) .capsule-card");
await h.win.click("#view-vault [data-verify]");
await h.win.waitForFunction(() => !/Checking/.test(document.querySelector("#view-vault .check-result").textContent), null, { timeout: 60000 });
step("check on Ana's computer: " + (await h.win.textContent("#view-vault .check-result")));
await h.win.click("#view-vault [data-listen]");
await h.win.waitForFunction(() => document.querySelectorAll("#listen-media audio").length > 0, null, { timeout: 60000 });
await h.win.click("#play");
await h.win.waitForTimeout(2000);
step("listening on Ana's computer: " + (await h.win.$$eval("#listen-media audio", (els) => els.map((m) => `${m.currentTime.toFixed(1)}s`).join(", "))));
await h.win.screenshot({ path: path.join(OUT, "heir-6-listening.png") });
const keys = await h.app.evaluate(async ({ app }) => app.getPath("userData"));
const files = fs.readdirSync(keys);
step(`Ana's computer holds no signing key: ${!files.some((n) => /fellow-keys/.test(n))}`);
await h.app.close();
await chrome.close();
step("done");
