#!/usr/bin/env node
// sondage-verify — check a Sondage capsule without the app or an account.
//
//   sondage-verify <capsule.age> --identity <AGE-SECRET-KEY-… or file>   open and check everything
//   sondage-verify <capsule.age> --identity … --extract <folder>         also keep the opened files
//   sondage-verify <opened-folder>                                        check an already-opened capsule
//   sondage-verify <capsule.age> --receipt <receipt.json>                 check the sealed file matches its receipt

import fs from "node:fs";
import path from "node:path";
import { openAndVerify, verifyObject, readReceipt, checkAgainstReceipt } from "../src/core/verify.js";

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const target = args.find((a, i) => !a.startsWith("--") && !["--identity", "--extract", "--receipt"].includes(args[i - 1]));

if (!target) {
  console.log(fs.readFileSync(new URL(import.meta.url), "utf8").split("\n").slice(1, 8).map((l) => l.replace(/^\/\/ ?/, "")).join("\n"));
  process.exit(2);
}

function print(result) {
  for (const c of result.checks) {
    console.log(`${c.ok ? "  ok  " : "  FAIL"}  ${c.name}${c.detail ? `\n          ${c.detail}` : ""}`);
  }
  if (result.manifest) {
    const m = result.manifest;
    console.log(`\nCapsule ${m.capsuleId} · ${m.session.title || "Interview"} · sealed ${m.createdAt}`);
    console.log(`Fellow: ${m.participants.fellow.name} · Historian: ${m.participants.historian.name}`);
  }
  console.log(result.ok ? "\nVERIFIED: this capsule is complete and unchanged since it was sealed." : "\nNOT VERIFIED: see the failures above.");
  process.exit(result.ok ? 0 : 1);
}

const stat = fs.statSync(target);
if (stat.isDirectory()) {
  print(await verifyObject(target));
} else {
  const receiptPath = opt("--receipt");
  if (receiptPath) {
    const receipt = await readReceipt(receiptPath);
    const ok = await checkAgainstReceipt(target, receipt);
    console.log(`${ok ? "  ok  " : "  FAIL"}  ${path.basename(target)} matches its receipt (manifest ${receipt.manifestSha256.slice(0, 16)}…)`);
    if (!opt("--identity")) process.exit(ok ? 0 : 1);
  }
  let identity = opt("--identity");
  if (!identity) {
    console.error("To open a capsule, pass the Fellow's key with --identity.");
    process.exit(2);
  }
  if (!identity.startsWith("AGE-SECRET-KEY-")) identity = fs.readFileSync(identity, "utf8").trim().split("\n").find((l) => l.startsWith("AGE-SECRET-KEY-"));
  const extract = opt("--extract");
  if (extract) fs.mkdirSync(extract, { recursive: true });
  const result = await openAndVerify(target, identity, { keepDir: extract });
  if (!extract) await result.cleanup();
  else console.log(`Opened files kept in ${path.resolve(extract)}`);
  print(result);
}
