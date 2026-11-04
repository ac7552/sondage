import { test } from "node:test";
import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { RecordingSession } from "../src/core/capsule.js";
import { openAndVerify, verifyObject, checkAgainstReceipt } from "../src/core/verify.js";
import * as keys from "../src/core/keys.js";
import { buildTimeStampQuery, inspectTimestampResponse } from "../src/core/tsa.js";
import { parseWavHeader } from "../src/core/wav.js";
import { sha256Hex, chainOf } from "../src/shared/chain.js";
import { ChunkSender, ChunkReceiver, wire, sendControl } from "../src/shared/transfer.js";

const SR = 48000;
function tone(freq, seconds, start = 0) {
  const n = Math.round(SR * seconds);
  const a = new Float32Array(n);
  for (let i = 0; i < n; i++) a[i] = 0.25 * Math.sin((2 * Math.PI * freq * (start + i)) / SR);
  return a;
}

// The historian signs in the browser with WebCrypto; do the same here.
async function historianKeys() {
  const kp = await crypto.subtle.generateKey({ name: "Ed25519" }, false, ["sign", "verify"]);
  const raw = Buffer.from(await crypto.subtle.exportKey("raw", kp.publicKey)).toString("base64");
  return {
    publicKey: raw,
    sign: async (bytes) => Buffer.from(await crypto.subtle.sign({ name: "Ed25519" }, kp.privateKey, bytes)).toString("base64"),
  };
}

async function recordSession(tmp, fellow, historian) {
  const s = await RecordingSession.open(path.join(tmp, "staging"), "42", { title: "Test interview" });
  await s.ensureTrack({ id: "fellow-audio", kind: "audio", role: "fellow", info: { sampleRate: SR, processing: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }, device: { label: "Test mic" } } });
  await s.ensureTrack({ id: "historian-audio", kind: "audio", role: "historian", info: { sampleRate: SR } });
  let start = 0;
  for (let i = 0; i < 3; i++) {
    const f = tone(220, 1, start);
    await s.writeChunk("fellow-audio", i, f.buffer, { sampleStart: start, sampleCount: f.length });
    const h = tone(330, 1, start);
    await s.writeChunk("historian-audio", i, h.buffer, { expectedSha256: await sha256Hex(new Uint8Array(h.buffer)), sampleStart: start, sampleCount: h.length });
    start += f.length;
  }
  await s.endTrack("fellow-audio", { startedAt: "2026-11-03T20:00:00Z", endedAt: "2026-11-03T20:00:03Z" });
  await s.endTrack("historian-audio", {});
  const built = await s.buildManifest({
    capsuleId: "test-capsule-1",
    session: { id: "42", title: "Test interview", mediaType: "audio", startedAt: "2026-11-03T20:00:00Z", endedAt: "2026-11-03T20:00:03Z" },
    fellow: { name: "Ada Fellow", signingPublicKey: fellow.signingPublicKey, ageRecipient: fellow.ageRecipient },
    historian: { name: "Hal Historian", signingPublicKey: historian.publicKey },
    timeline: { eras: [{ title: "Childhood" }] },
    software: { app: "sondage-desktop test" },
  });
  return { s, built };
}

test("record, seal, open and verify a capsule; tampering is detected", async () => {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "sondage-test-"));
  const fellow = await keys.generateFellowKeys();
  const historian = await historianKeys();
  const { s, built } = await recordSession(tmp, fellow, historian);

  // The historian's chain, computed independently in "their browser", matches.
  const hTrack = built.manifest.tracks.find((t) => t.id === "historian-audio");
  assert.equal(await chainOf("42", "historian-audio", hTrack.chunks.map((c) => c.sha256)), hTrack.finalChain);

  const historianSignature = await historian.sign(Buffer.from(built.manifestText));
  const vault = path.join(tmp, "vault");
  const { receipt, capsulePath } = await s.seal({ fellowKeys: fellow, historianSignature, historianPublicKey: historian.publicKey, vaultDir: vault, tsaUrl: null });
  assert.equal(receipt.manifestSha256, built.manifestSha256);
  assert.ok(await checkAgainstReceipt(capsulePath, receipt));
  await assert.rejects(fsp.stat(s.dir), "staging removed after sealing");

  // Opens only with the Fellow's key.
  const stranger = await keys.generateFellowKeys();
  const denied = await openAndVerify(capsulePath, stranger.ageIdentity);
  assert.equal(denied.ok, false);
  await denied.cleanup();

  const opened = await openAndVerify(capsulePath, fellow.ageIdentity);
  for (const c of opened.checks) assert.ok(c.ok, `${c.name}: ${c.detail || ""}`);
  assert.ok(opened.ok);

  // The audio is a real 32-bit float WAV with every sample intact.
  const wavBuf = await fsp.readFile(path.join(opened.objectDir, "v1/content/audio/fellow-audio.wav"));
  const wav = parseWavHeader(wavBuf);
  assert.deepEqual([wav.format, wav.bitsPerSample, wav.sampleRate], [3, 32, SR]);
  assert.equal(wav.dataBytes, SR * 3 * 4);
  const samples = new Float32Array(wavBuf.buffer.slice(wavBuf.byteOffset + wav.dataOffset, wavBuf.byteOffset + wav.dataOffset + wav.dataBytes));
  assert.deepEqual(Array.from(samples.slice(0, 100)), Array.from(tone(220, 3).slice(0, 100)));

  // Change a single sample in the middle chunk: the chain must break there.
  const f = path.join(opened.objectDir, "v1/content/audio/fellow-audio.wav");
  const buf = await fsp.readFile(f);
  buf.writeFloatLE(0.9, wav.dataOffset + SR * 4 + 400);
  await fsp.writeFile(f, buf);
  const tampered = await verifyObject(opened.objectDir);
  assert.equal(tampered.ok, false);
  const chain = tampered.checks.find((c) => c.name.startsWith("audio/fellow-audio.wav: hash chain"));
  assert.equal(chain.ok, false);
  assert.match(chain.detail, /chunk 1/);
  await opened.cleanup();

  // Editing the manifest invalidates both signatures.
  const o2 = await openAndVerify(capsulePath, fellow.ageIdentity);
  const mf = path.join(o2.objectDir, "v1/content/manifest.json");
  await fsp.writeFile(mf, (await fsp.readFile(mf, "utf8")).replace("Ada Fellow", "Someone Else"));
  const forged = await verifyObject(o2.objectDir);
  assert.equal(forged.checks.find((c) => c.name.startsWith("Fellow signature")).ok, false);
  await o2.cleanup();
  await fsp.rm(tmp, { recursive: true, force: true });
});

test("sealing refuses a historian signature that does not verify", async () => {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "sondage-test-"));
  const fellow = await keys.generateFellowKeys();
  const historian = await historianKeys();
  const imposter = await historianKeys();
  const { s, built } = await recordSession(tmp, fellow, historian);
  const badSig = await imposter.sign(Buffer.from(built.manifestText));
  await assert.rejects(s.seal({ fellowKeys: fellow, historianSignature: badSig, historianPublicKey: historian.publicKey, vaultDir: path.join(tmp, "v"), tsaUrl: null }), /does not verify/);
  await fsp.rm(tmp, { recursive: true, force: true });
});

test("chunks must arrive in order and cannot be silently replaced", async () => {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "sondage-test-"));
  const s = await RecordingSession.open(tmp, "7");
  await s.ensureTrack({ id: "fellow-audio", kind: "audio", role: "fellow", info: { sampleRate: SR } });
  const a = tone(100, 0.1);
  await s.writeChunk("fellow-audio", 0, a.buffer);
  await s.writeChunk("fellow-audio", 0, a.buffer); // identical resend is fine
  await assert.rejects(s.writeChunk("fellow-audio", 0, tone(200, 0.1).buffer), /different contents/);
  await assert.rejects(s.writeChunk("fellow-audio", 2, a.buffer), /out of order/);
  // Survives a restart: state is reloaded from disk.
  const again = await RecordingSession.open(tmp, "7");
  assert.equal(again.trackStatus()[0].chunks, 1);
  await fsp.rm(tmp, { recursive: true, force: true });
});

test("recovery shares: any 2 of 4 restore the keys", async () => {
  const k = await keys.generateFellowKeys();
  const shares = await keys.splitForRecovery(k, { shares: 4, threshold: 2 });
  assert.equal(shares.length, 4);
  for (const s of shares) assert.equal(s.replace(/^SONDAGE-\d+\s+/, "").replace(/\s+/g, "").length, 132);
  for (const [i, j] of [[0, 1], [2, 0], [1, 3], [3, 2]]) {
    const restored = await keys.restoreFromShares([shares[i], shares[j]]);
    assert.equal(restored.ageIdentity, k.ageIdentity);
    assert.equal(restored.signingPrivateKey, k.signingPrivateKey);
  }
  const restored = await keys.restoreFromShares([shares[2], shares[0]]);
  const sig = keys.sign(restored, Buffer.from("hello"));
  assert.ok(keys.verify(k.signingPublicKey, Buffer.from("hello"), sig));
});

test("an heir gets only the unlocking key: Sondage's unlocking half can't rebuild the signing key", async () => {
  const k = await keys.generateFellowKeys();
  const [, heir, , sondage] = await keys.splitForRecovery(k, { shares: 4, threshold: 2 });
  const half = keys.unlockingHalf(sondage);
  assert.equal(half.length, 66);
  const unlocked = await keys.restoreUnlockingKey([heir, half]);
  assert.equal(unlocked.ageIdentity, k.ageIdentity);
  assert.equal(unlocked.ageRecipient, k.ageRecipient);
  assert.equal(unlocked.signingPrivateKey, undefined);
  // A half is not a whole copy: the full restore refuses it.
  await assert.rejects(keys.restoreFromShares([heir, half]), /don't belong together/);
});

test("copies made by earlier versions (both secrets in one share) still restore", async () => {
  const { split } = await import("shamir-secret-sharing");
  const k = await keys.generateFellowKeys();
  const seed = Buffer.from(k.signingPrivateKey, "base64").subarray(-32);
  const parts = await split(new Uint8Array(Buffer.concat([seed, bech32X25519(k.ageIdentity)])), 3, 2);
  const legacy = parts.map((p, i) => `SONDAGE-${i + 1} ` + Buffer.from(p).toString("hex").toUpperCase());
  const restored = await keys.restoreFromShares([legacy[0], legacy[2]]);
  assert.equal(restored.ageIdentity, k.ageIdentity);
  assert.equal(restored.signingPrivateKey, k.signingPrivateKey);
  assert.equal((await keys.restoreUnlockingKey([legacy[1], legacy[2]])).ageIdentity, k.ageIdentity);
});

// age's Bech32 secret key back to its 32 bytes (test helper; mirrors keys.js).
function bech32X25519(identity) {
  const CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
  const s = identity.toLowerCase();
  const data = [...s.slice(s.lastIndexOf("1") + 1)].map((c) => CHARSET.indexOf(c)).slice(0, -6);
  let acc = 0, bits = 0;
  const out = [];
  for (const v of data) {
    acc = (acc << 5) | v;
    bits += 5;
    while (bits >= 8) { bits -= 8; out.push((acc >> bits) & 255); }
  }
  return Buffer.from(out);
}

test("the verifier compares keys with an outside record, and says when it hasn't", async () => {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "sondage-test-"));
  const fellow = await keys.generateFellowKeys();
  const historian = await historianKeys();
  const { s, built } = await recordSession(tmp, fellow, historian);
  const historianSignature = await historian.sign(Buffer.from(built.manifestText));
  const { receipt, capsulePath } = await s.seal({ fellowKeys: fellow, historianSignature, historianPublicKey: historian.publicKey, vaultDir: path.join(tmp, "v"), tsaUrl: null });

  const bare = await openAndVerify(capsulePath, fellow.ageIdentity);
  assert.ok(bare.ok);
  assert.equal(bare.anchored, false);
  await bare.cleanup();

  const right = await openAndVerify(capsulePath, fellow.ageIdentity, { expected: { fellowKey: keys.fingerprint(fellow.signingPublicKey), historianKey: historian.publicKey, manifestSha256: receipt.manifestSha256 } });
  for (const c of right.checks) assert.ok(c.ok, `${c.name}: ${c.detail || ""}`);
  assert.equal(right.anchored, true);
  await right.cleanup();

  // A forger can make a capsule that checks out on its own, but not one that matches the record.
  const other = await keys.generateFellowKeys();
  const wrong = await openAndVerify(capsulePath, fellow.ageIdentity, { expected: { fellowKey: keys.fingerprint(other.signingPublicKey) } });
  assert.equal(wrong.ok, false);
  assert.ok(wrong.checks.some((c) => c.name.startsWith("Fellow key matches") && !c.ok));
  await wrong.cleanup();
  await fsp.rm(tmp, { recursive: true, force: true });
});

test("the seal record makes a removed or swapped timestamp detectable", async () => {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "sondage-test-"));
  const fellow = await keys.generateFellowKeys();
  const historian = await historianKeys();
  const { s, built } = await recordSession(tmp, fellow, historian);
  assert.deepEqual(built.manifest.sealing, { record: "seal.json", timestampRequested: false, timestampAuthority: null });
  const historianSignature = await historian.sign(Buffer.from(built.manifestText));
  const { capsulePath } = await s.seal({ fellowKeys: fellow, historianSignature, historianPublicKey: historian.publicKey, vaultDir: path.join(tmp, "v"), tsaUrl: null });

  const o = await openAndVerify(capsulePath, fellow.ageIdentity);
  assert.ok(o.checks.find((c) => c.name === "Seal record signed by the Fellow").ok);
  const content = path.join(o.objectDir, "v1/content");

  // A timestamp file appearing that the seal record never mentioned is refused.
  await fsp.writeFile(path.join(content, "timestamp.tsr"), Buffer.from([0x30, 0x00]));
  assert.equal((await verifyObject(o.objectDir)).checks.find((c) => c.name === "Trusted timestamp").ok, false);
  await fsp.rm(path.join(content, "timestamp.tsr"));

  // Editing the seal record (say, to claim a timestamp) breaks the Fellow's signature on it.
  const sealFile = path.join(content, "seal.json");
  const record = JSON.parse(await fsp.readFile(sealFile, "utf8"));
  record.timestamp.status = "granted";
  await fsp.writeFile(sealFile, JSON.stringify(record, null, 2) + "\n");
  assert.equal((await verifyObject(o.objectDir)).checks.find((c) => c.name === "Seal record signed by the Fellow").ok, false);

  // Deleting it is detected too: the signed manifest says it must be there.
  await fsp.rm(sealFile);
  assert.equal((await verifyObject(o.objectDir)).checks.find((c) => c.name === "Seal record signed by the Fellow").ok, false);
  await o.cleanup();
  await fsp.rm(tmp, { recursive: true, force: true });
});

test("RFC 3161 query is valid DER", async (t) => {
  const hash = "a".repeat(64);
  const q = buildTimeStampQuery(hash);
  const tmp = path.join(os.tmpdir(), `tsq-${process.pid}.der`);
  await fsp.writeFile(tmp, q);
  try {
    const out = execFileSync("openssl", ["ts", "-query", "-in", tmp, "-text"], { encoding: "utf8" });
    assert.match(out, /Hash Algorithm: sha256/);
    assert.match(out, /aa aa aa/i);
    assert.match(out, /Certificate required: yes/);
  } catch (err) {
    if (err.code === "ENOENT") t.skip("openssl not installed");
    else throw err;
  } finally {
    await fsp.rm(tmp, { force: true });
  }
  assert.equal(inspectTimestampResponse(Buffer.from([0x30, 0x05, 0x30, 0x03, 0x02, 0x01, 0x02]), hash).granted, false);
});

test("chunk transfer survives a dropped connection without duplicates", async () => {
  // A pair of fake data channels.
  function pair() {
    const mk = () => ({ readyState: "open", bufferedAmount: 0, listeners: {}, addEventListener(t, f) { (this.listeners[t] ||= []).push(f); }, removeEventListener() {} });
    const a = mk(), b = mk();
    a.send = (d) => b.readyState === "open" && a.readyState === "open" && (b.listeners.message || []).forEach((f) => f({ data: d }));
    b.send = (d) => a.readyState === "open" && b.readyState === "open" && (a.listeners.message || []).forEach((f) => f({ data: d }));
    return [a, b];
  }
  const received = new Map();
  const controls = [];
  const sender = new ChunkSender();
  const receiver = new ChunkReceiver({ onChunk: async (c) => received.set(c.index, c.sha256), onControl: (m) => controls.push(m.t) });
  const idle = { send() {}, attach() {}, receive() {}, handle() {} };
  let [a, b] = pair();
  wire(a, { sender, receiver: idle });
  wire(b, { sender: idle, receiver });
  sendControl(a, { t: "track", id: "historian-audio" });

  const make = async (i) => {
    const bytes = tone(100 + i, 0.5).buffer;
    return { track: "historian-audio", index: i, bytes, sha256: await sha256Hex(new Uint8Array(bytes)) };
  };
  await sender.send(await make(0));
  await receiver.queue; // chunk 0 acknowledged
  assert.equal(sender.pendingCount, 0);
  a.readyState = "closed"; // connection drops
  await sender.send(await make(1));
  await sender.send(await make(2));
  await receiver.queue;
  assert.equal(sender.pendingCount, 2);

  [a, b] = pair(); // reconnect
  wire(b, { sender: idle, receiver });
  wire(a, { sender, receiver: idle });
  await sender.sending;
  await receiver.queue;
  await sender.drained(2000);
  assert.deepEqual([...received.keys()].sort(), [0, 1, 2]);
  assert.deepEqual(controls, ["track"]);
});
