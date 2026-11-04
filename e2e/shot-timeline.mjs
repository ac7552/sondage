import { chromium } from "playwright-core";
import fs from "node:fs";
fs.mkdirSync("out", { recursive: true });
const b = await chromium.launch({ executablePath: process.env.CHROME || "/usr/bin/google-chrome", args: ["--no-sandbox"] });
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
const errs = [];
p.on("pageerror", (e) => errs.push(e.message));
p.on("console", (m) => m.type() === "error" && errs.push(m.text()));
await p.goto("http://localhost:3999/timeline");
await p.waitForTimeout(1500);
await p.screenshot({ path: "out/tl-0-overview.png" });
const vh = 900, HOLD = 0.55, MOVE = 0.85;
for (const [k, name] of [[1, "tl-1-chapter1"], [3, "tl-3-chapter3"]]) {
  await p.evaluate((y) => scrollTo(0, y), (k * (HOLD + MOVE) + HOLD * 0.5) * vh);
  await p.waitForTimeout(700);
  await p.screenshot({ path: `out/${name}.png` });
}
await p.evaluate((y) => scrollTo(0, y), (2 * (HOLD + MOVE) - 0.2) * vh);
await p.waitForTimeout(500);
await p.screenshot({ path: "out/tl-2-transition.png" });
await p.evaluate((y) => scrollTo(0, y), (1 * (HOLD + MOVE) + HOLD * 0.5) * vh);
await p.waitForTimeout(600);
await p.locator(".card.k-photo").first().click({ force: true });
await p.waitForTimeout(500);
await p.screenshot({ path: "out/tl-4-detail.png" });
await p.keyboard.press("Escape");
const card = p.locator('.card.k-song[data-era="0"]');
if (await card.count()) { await card.first().click({ force: true }); await p.waitForTimeout(400); await p.screenshot({ path: "out/tl-5-song.png" }); }
console.log("errors:", errs);
await b.close();
