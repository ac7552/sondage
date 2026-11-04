#!/usr/bin/env node
// Fingerprints of the scripts the browser runs on the pages that handle keys.
//
// The safety-copy page and the interview room are served by Sondage, so Sondage (or
// anyone who took over its server) could send different code. Publishing these hashes
// in the repository, and checking them in CI, means any change to what those pages run
// shows up in review, and anyone can compare what a live server sends with this file:
//
//   curl -s https://<server>/sondage/safety.js | shasum -a 384 | xxd -r -p | base64
//
//   node scripts/script-hashes.mjs          write web/public/sondage/hashes.json
//   node scripts/script-hashes.mjs --check  fail if it is out of date (CI)

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dir = path.join(root, "web", "public", "sondage");
const out = path.join(dir, "hashes.json");

function walk(d, rel = "") {
  return fs.readdirSync(path.join(d, rel), { withFileTypes: true }).flatMap((e) => {
    const r = rel ? `${rel}/${e.name}` : e.name;
    return e.isDirectory() ? walk(d, r) : r.endsWith(".js") ? [r] : [];
  });
}

const files = walk(dir).sort();
const hashes = Object.fromEntries(files.map((f) => [f, "sha384-" + crypto.createHash("sha384").update(fs.readFileSync(path.join(dir, f))).digest("base64")]));
const text = JSON.stringify({ about: "SHA-384 of each script under /sondage/, as served. Regenerate with node scripts/script-hashes.mjs.", files: hashes }, null, 2) + "\n";

if (process.argv.includes("--check")) {
  const current = fs.existsSync(out) ? fs.readFileSync(out, "utf8") : "";
  if (current !== text) {
    console.error("web/public/sondage/hashes.json is out of date. Run: node scripts/script-hashes.mjs");
    process.exit(1);
  }
  console.log(`Script hashes match (${files.length} files).`);
} else {
  fs.writeFileSync(out, text);
  console.log(`Wrote ${path.relative(root, out)} (${files.length} files).`);
}
