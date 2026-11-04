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

test("recovery shares: any 2 of 3 restore the keys", async () => {
  const k = await keys.generateFellowKeys();
  const shares = await keys.splitForRecovery(k);
  assert.equal(shares.length, 3);
  const restored = await keys.restoreFromShares([shares[2], shares[0]]);
  assert.equal(restored.ageIdentity, k.ageIdentity);
  assert.equal(restored.signingPrivateKey, k.signingPrivateKey);
  const sig = keys.sign(restored, Buffer.from("hello"));
  assert.ok(keys.verify(k.signingPublicKey, Buffer.from("hello"), sig));
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
