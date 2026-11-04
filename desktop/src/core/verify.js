// Checks a Sondage capsule end to end. Used by the desktop app and the
// standalone `sondage-verify` command, so anyone can check a capsule decades later.

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import * as tar from "tar";
import { Decrypter } from "age-encryption";
import { genesis, nextLink } from "../shared/chain.js";
import { verify as verifySignature, fingerprint } from "./keys.js";
import { inspectTimestampResponse } from "./tsa.js";
import { parseWavHeader } from "./wav.js";
import { fileDigest } from "./capsule.js";

// Decrypts a .capsule.age file into a temporary folder and verifies it.
// Returns { ok, checks, manifest, objectDir }. Call cleanup() when done.
export async function openAndVerify(capsulePath, ageIdentity, { keepDir } = {}) {
  const objectDir = keepDir || (await fsp.mkdtemp(path.join(os.tmpdir(), "sondage-open-")));
  const checks = [];
  try {
    const d = new Decrypter();
    d.addIdentity(ageIdentity);
    const plain = await d.decrypt(Readable.toWeb(fs.createReadStream(capsulePath)));
    await pipeline(Readable.fromWeb(plain), tar.x({ cwd: objectDir, strict: true }));
    checks.push({ name: "Opened with the Fellow's key", ok: true });
  } catch (err) {
    checks.push({ name: "Opened with the Fellow's key", ok: false, detail: String(err.message || err) });
    return { ok: false, checks, objectDir, cleanup: () => fsp.rm(objectDir, { recursive: true, force: true }) };
  }
  const result = await verifyObject(objectDir);
  result.checks.unshift(...checks);
  return { ...result, objectDir, cleanup: () => fsp.rm(objectDir, { recursive: true, force: true }) };
}

// Verifies an already-opened OCFL object folder.
export async function verifyObject(objectDir) {
  const checks = [];
  const add = (name, ok, detail) => checks.push({ name, ok, ...(detail ? { detail } : {}) });
  const content = path.join(objectDir, "v1", "content");

  // OCFL structure and fixity
  try {
    const nam = await fsp.readFile(path.join(objectDir, "0=ocfl_object_1.1"), "utf8");
    add("OCFL object declaration", nam === "ocfl_object_1.1\n");
    const invText = await fsp.readFile(path.join(objectDir, "inventory.json"));
    const side = (await fsp.readFile(path.join(objectDir, "inventory.json.sha512"), "utf8")).split(/\s+/)[0];
    add("OCFL inventory digest", crypto.createHash("sha512").update(invText).digest("hex") === side);
    const inv = JSON.parse(invText);
    let bad = [];
    for (const [digest, paths] of Object.entries(inv.manifest)) {
      for (const p of paths) {
        const actual = await fileDigest(path.join(objectDir, p), "sha512").catch(() => "missing");
        if (actual !== digest) bad.push(p);
      }
    }
    add("Every file matches the OCFL inventory (SHA-512)", bad.length === 0, bad.length ? `Changed or missing: ${bad.join(", ")}` : undefined);
  } catch (err) {
    add("OCFL structure", false, String(err.message || err));
  }

  let manifest, manifestBytes;
  try {
    manifestBytes = await fsp.readFile(path.join(content, "manifest.json"));
    manifest = JSON.parse(manifestBytes);
    add("Manifest present", true);
  } catch (err) {
    add("Manifest present", false, String(err.message || err));
    return { ok: false, checks };
  }
  const manifestSha256 = crypto.createHash("sha256").update(manifestBytes).digest("hex");

  // Signatures
  try {
    const sigs = JSON.parse(await fsp.readFile(path.join(content, "signatures.json"), "utf8"));
    add("Signatures cover this exact manifest", sigs.manifestSha256 === manifestSha256);
    for (const role of ["fellow", "historian"]) {
      const s = sigs.signatures.find((x) => x.role === role);
      const expectedKey = manifest.participants[role].signingPublicKey;
      const ok = !!s && s.publicKey === expectedKey && verifySignature(expectedKey, manifestBytes, s.signature);
      add(`${role === "fellow" ? "Fellow" : "Historian"} signature (${manifest.participants[role].name}, key ${fingerprint(expectedKey)})`, ok);
    }
  } catch (err) {
    add("Signatures", false, String(err.message || err));
  }

  // Timestamp
  try {
    const tsr = await fsp.readFile(path.join(content, "timestamp.tsr"));
    const info = inspectTimestampResponse(tsr, manifestSha256);
    add("Trusted timestamp covers the manifest", info.granted && info.coversHash, info.genTime ? `Timestamped ${info.genTime} (confirm the authority's certificate with openssl ts -verify)` : undefined);
  } catch {
    add("Trusted timestamp", true, "None in this capsule: the time was not independently certified when it was sealed");
  }

  // Files and hash chains
  for (const t of manifest.tracks) {
    const file = path.join(content, t.file);
    const digest = await fileDigest(file).catch(() => "missing");
    add(`${t.file}: file hash`, digest === t.sha256);
    try {
      const fh = await fsp.open(file, "r");
      try {
        if (t.kind === "audio") {
          const head = Buffer.alloc(4096);
          await fh.read(head, 0, 4096, 0);
          const wav = parseWavHeader(head);
          add(`${t.file}: 32-bit float WAV, ${wav.sampleRate} Hz`, wav.format === 3 && wav.bitsPerSample === 32 && wav.sampleRate === t.audio.sampleRate);
        }
        let link = await genesis(manifest.session.id, t.id);
        let ok = link === t.chainGenesis;
        let firstBad = null;
        for (const c of t.chunks) {
          const buf = Buffer.alloc(c.byteLength);
          await fh.read(buf, 0, c.byteLength, c.byteOffset);
          const h = crypto.createHash("sha256").update(buf).digest("hex");
          link = await nextLink(link, h);
          if (h !== c.sha256 || link !== c.chain) {
            ok = false;
            if (firstBad === null) firstBad = c.index;
          }
        }
        ok = ok && link === t.finalChain;
        add(`${t.file}: hash chain of ${t.chunks.length} chunks`, ok, firstBad !== null ? `First break at chunk ${firstBad}` : undefined);
      } finally {
        await fh.close();
      }
    } catch (err) {
      add(`${t.file}: hash chain`, false, String(err.message || err));
    }
  }
  for (const f of manifest.files || []) {
    const digest = await fileDigest(path.join(content, f.file)).catch(() => "missing");
    add(`${f.file}: file hash`, digest === f.sha256);
  }

  return { ok: checks.every((c) => c.ok), checks, manifest, manifestSha256 };
}

export async function readReceipt(receiptPath) {
  return JSON.parse(await fsp.readFile(receiptPath, "utf8"));
}

// Checks a capsule file against its public receipt without opening it.
export async function checkAgainstReceipt(capsulePath, receipt) {
  const digest = await fileDigest(capsulePath);
  return digest === receipt.capsuleSha256;
}
