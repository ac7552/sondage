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
// Returns { ok, anchored, checks, manifest, objectDir }. Call cleanup() when done.
// ageIdentity may be one identity or a list (the Fellow's own, and any inherited ones).
// expected: see verifyObject.
export async function openAndVerify(capsulePath, ageIdentity, { keepDir, expected } = {}) {
  const objectDir = keepDir || (await fsp.mkdtemp(path.join(os.tmpdir(), "sondage-open-")));
  const checks = [];
  try {
    const d = new Decrypter();
    for (const id of [].concat(ageIdentity).filter(Boolean)) d.addIdentity(id);
    const plain = await d.decrypt(Readable.toWeb(fs.createReadStream(capsulePath)));
    await pipeline(Readable.fromWeb(plain), tar.x({ cwd: objectDir, strict: true }));
    checks.push({ name: "Opened with the Fellow's key", ok: true });
  } catch (err) {
    checks.push({ name: "Opened with the Fellow's key", ok: false, detail: String(err.message || err) });
    return { ok: false, checks, objectDir, cleanup: () => fsp.rm(objectDir, { recursive: true, force: true }) };
  }
  const result = await verifyObject(objectDir, { expected });
  result.checks.unshift(...checks);
  return { ...result, objectDir, cleanup: () => fsp.rm(objectDir, { recursive: true, force: true }) };
}

// Verifies an already-opened OCFL object folder.
//
// The keys named inside a capsule only prove that whoever holds them signed it. To say
// *whose* keys they are, compare them with a record from outside the capsule:
//   expected = { fellowKey, historianKey, manifestSha256 }
// Each may be a raw base64 public key or a fingerprint ("1A2B 3C4D …"). Without any,
// the result is ok but not anchored, and says so.
export async function verifyObject(objectDir, { expected = {} } = {}) {
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
  let sigs = null;
  try {
    sigs = JSON.parse(await fsp.readFile(path.join(content, "signatures.json"), "utf8"));
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

  // Whose keys: compared with a record from outside the capsule.
  let anchored = false;
  const anchors = [
    ["fellow", "Fellow", expected.fellowKey],
    ["historian", "Historian", expected.historianKey],
  ];
  for (const [role, label, want] of anchors) {
    if (!want) continue;
    anchored = true;
    const have = manifest.participants?.[role]?.signingPublicKey;
    const ok = !!have && sameKey(have, want);
    add(`${label} key matches the outside record (${fingerprintOf(want)})`, ok, ok ? undefined : `The capsule names key ${have ? fingerprint(have) : "none"}`);
  }
  if (expected.manifestSha256) {
    anchored = true;
    add("Manifest matches the outside record", expected.manifestSha256.toLowerCase() === manifestSha256);
  }
  if (!anchored) {
    add("Keys compared with an outside record", true, "Not checked. Anyone can make keys and sign a capsule; compare the fingerprints above with the printed certificate or receipt, or run again with --fellow-key or --receipt.");
  }

  // Seal record and timestamp
  let tsr = null;
  try { tsr = await fsp.readFile(path.join(content, "timestamp.tsr")); } catch {}
  let record = null;
  if (manifest.sealing) {
    try {
      const recordBytes = await fsp.readFile(path.join(content, manifest.sealing.record || "seal.json"));
      record = JSON.parse(recordBytes);
      const s = sigs?.seal;
      const fellowKey = manifest.participants.fellow.signingPublicKey;
      const ok = !!s && s.publicKey === fellowKey && verifySignature(fellowKey, recordBytes, s.signature) && record.manifestSha256 === manifestSha256 && record.capsuleId === manifest.capsuleId;
      add("Seal record signed by the Fellow", ok);
    } catch (err) {
      add("Seal record signed by the Fellow", false, `The manifest says there is one, but it is missing or unreadable (${err.message || err})`);
    }
  }
  if (record) {
    const ts = record.timestamp || {};
    if (ts.status === "granted") {
      const digest = tsr ? crypto.createHash("sha256").update(tsr).digest("hex") : null;
      if (!tsr) add("Trusted timestamp", false, "The seal record says one was granted, but timestamp.tsr is missing");
      else if (digest !== ts.tsrSha256) add("Trusted timestamp", false, "timestamp.tsr is not the one recorded at sealing");
      else checkTsr();
    } else if (tsr) {
      add("Trusted timestamp", false, "timestamp.tsr is present, but the seal record says none was granted");
    } else if (manifest.sealing.timestampRequested) {
      add("Trusted timestamp", true, `Asked for from ${ts.authority || manifest.sealing.timestampAuthority}, but the service wasn't reachable when it was sealed (${ts.status}). The time was not independently certified.`);
    } else {
      add("Trusted timestamp", true, "Not asked for when it was sealed: the time was not independently certified");
    }
  } else if (!manifest.sealing) {
    // Capsules from before the seal record.
    if (tsr) checkTsr();
    else add("Trusted timestamp", true, "None in this capsule: the time was not independently certified when it was sealed (made by an earlier version, which can't show whether one was asked for)");
  }
  function checkTsr() {
    try {
      const info = inspectTimestampResponse(tsr, manifestSha256);
      add("Trusted timestamp covers the manifest", info.granted && info.coversHash, info.genTime ? `Timestamped ${info.genTime} (confirm the authority's certificate with openssl ts -verify)` : undefined);
    } catch (err) {
      add("Trusted timestamp covers the manifest", false, String(err.message || err));
    }
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

  return { ok: checks.every((c) => c.ok), anchored, checks, manifest, manifestSha256 };
}

// Keys may be given raw (base64, 32 bytes) or as a fingerprint people read aloud.
const normFp = (s) => String(s).replace(/[\s:-]/g, "").toUpperCase();
function isFingerprint(s) {
  return /^[0-9A-F]{16}$/.test(normFp(s));
}
function fingerprintOf(s) {
  return isFingerprint(s) ? normFp(s).match(/.{4}/g).join(" ") : fingerprint(s);
}
function sameKey(rawKey, want) {
  if (isFingerprint(want)) return normFp(fingerprint(rawKey)) === normFp(want);
  return rawKey === String(want).trim();
}

// What a receipt says about a capsule, in the form verifyObject expects.
export function expectedFromReceipt(receipt) {
  const key = (role) => receipt?.signatures?.find((s) => s.role === role)?.publicKey;
  return { fellowKey: key("fellow"), historianKey: key("historian"), manifestSha256: receipt?.manifestSha256 };
}

export async function readReceipt(receiptPath) {
  return JSON.parse(await fsp.readFile(receiptPath, "utf8"));
}

// Checks a capsule file against its public receipt without opening it.
export async function checkAgainstReceipt(capsulePath, receipt) {
  const digest = await fileDigest(capsulePath);
  return digest === receipt.capsuleSha256;
}
