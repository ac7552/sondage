// Recording staging, manifest, sealing and packaging for a Sondage capsule.
//
// During the interview every chunk is written to a staging folder on the Fellow's
// computer and hashed immediately (see shared/chain.js). At the end the chunks are
// joined into the final files, a manifest describes every byte, both people sign
// it, an independent authority timestamps it, and the whole package is encrypted
// to the Fellow's own key. Only then is the staging folder removed.

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import * as tar from "tar";
import { Encrypter } from "age-encryption";
import { genesis, nextLink, FORMAT } from "../shared/chain.js";
import { wavHeader } from "./wav.js";
import * as keys from "./keys.js";
import { requestTimestamp } from "./tsa.js";

const pad = (n) => String(n).padStart(6, "0");
const sha256 = (buf) => crypto.createHash("sha256").update(buf).digest("hex");

export async function fileDigest(file, algo = "sha256") {
  const h = crypto.createHash(algo);
  await pipeline(fs.createReadStream(file), h);
  return h.digest("hex");
}

async function writeDurable(file, data) {
  const fh = await fsp.open(file, "w");
  try {
    await fh.writeFile(data);
    await fh.sync();
  } finally {
    await fh.close();
  }
}

// ---------------------------------------------------------------- staging

export class RecordingSession {
  static async open(stagingRoot, sessionId, meta = {}) {
    const dir = path.join(stagingRoot, String(sessionId));
    await fsp.mkdir(path.join(dir, "chunks"), { recursive: true });
    const s = new RecordingSession(dir, String(sessionId));
    try {
      s.state = JSON.parse(await fsp.readFile(path.join(dir, "state.json"), "utf8"));
    } catch {
      s.state = { sessionId: String(sessionId), meta, tracks: {}, events: [], createdAt: new Date().toISOString() };
    }
    s.state.meta = { ...s.state.meta, ...meta };
    await s.save();
    return s;
  }

  constructor(dir, sessionId) {
    this.dir = dir;
    this.sessionId = sessionId;
    this.lock = Promise.resolve();
  }

  async save() {
    await writeDurable(path.join(this.dir, "state.json"), JSON.stringify(this.state, null, 2));
  }

  log(actor, action, detail) {
    this.state.events.push({ at: new Date().toISOString(), actor, action, ...(detail ? { detail } : {}) });
  }

  // track: { id, kind: 'audio'|'video', role: 'fellow'|'historian', ...info }
  async ensureTrack(track) {
    if (!this.state.tracks[track.id]) {
      this.state.tracks[track.id] = {
        id: track.id,
        kind: track.kind,
        role: track.role,
        info: track.info || {},
        chunks: [],
        link: await genesis(this.sessionId, track.id),
      };
      await fsp.mkdir(path.join(this.dir, "chunks", track.id), { recursive: true });
      this.log(track.role, "track-opened", track.id);
      await this.save();
    } else if (track.info) {
      Object.assign(this.state.tracks[track.id].info, track.info);
      await this.save();
    }
    return this.state.tracks[track.id];
  }

  // Chunks must arrive in order. A repeat of an already stored chunk is accepted
  // only if it is byte-for-byte identical.
  writeChunk(trackId, index, bytes, { expectedSha256, sampleStart, sampleCount } = {}) {
    const run = this.lock.then(() => this.#write(trackId, index, Buffer.from(bytes), { expectedSha256, sampleStart, sampleCount }));
    this.lock = run.catch(() => {});
    return run;
  }

  async #write(trackId, index, buf, { expectedSha256, sampleStart, sampleCount }) {
    const t = this.state.tracks[trackId];
    if (!t) throw new Error(`Unknown track ${trackId}`);
    const digest = sha256(buf);
    if (expectedSha256 && expectedSha256 !== digest) throw new Error("Chunk hash does not match what was sent");
    if (index < t.chunks.length) {
      if (t.chunks[index].sha256 === digest) return t.chunks[index];
      throw new Error(`Chunk ${index} of ${trackId} was already stored with different contents`);
    }
    if (index !== t.chunks.length) throw new Error(`Chunk ${index} of ${trackId} arrived out of order (expected ${t.chunks.length})`);
    await writeDurable(path.join(this.dir, "chunks", trackId, `${pad(index)}.bin`), buf);
    t.link = await nextLink(t.link, digest);
    const entry = { index, byteLength: buf.length, sha256: digest, chain: t.link, storedAt: new Date().toISOString() };
    if (t.kind === "audio") {
      entry.sampleStart = sampleStart ?? t.chunks.reduce((n, c) => n + c.sampleCount, 0);
      entry.sampleCount = sampleCount ?? buf.length / 4;
    }
    t.chunks.push(entry);
    await this.save();
    return entry;
  }

  async endTrack(trackId, summary) {
    const t = this.state.tracks[trackId];
    if (!t) return;
    t.ended = { ...summary, at: new Date().toISOString() };
    this.log(t.role, "track-ended", trackId);
    await this.save();
  }

  trackStatus() {
    return Object.values(this.state.tracks).map((t) => ({
      id: t.id,
      kind: t.kind,
      role: t.role,
      chunks: t.chunks.length,
      bytes: t.chunks.reduce((n, c) => n + c.byteLength, 0),
      link: t.link,
      ended: !!t.ended,
    }));
  }

  get objectDir() {
    return path.join(this.dir, "object");
  }
  get contentDir() {
    return path.join(this.objectDir, "v1", "content");
  }

  // ------------------------------------------------------------ manifest

  // context: { capsuleId, session:{...}, fellow:{name, signingPublicKey, ageRecipient},
  //            historian:{name, signingPublicKey}, timeline (object|null), software:{...} }
  async buildManifest(context) {
    const content = this.contentDir;
    await fsp.rm(this.objectDir, { recursive: true, force: true });
    await fsp.mkdir(content, { recursive: true });

    const tracks = [];
    for (const t of Object.values(this.state.tracks)) {
      if (t.chunks.length === 0) continue;
      const ext = t.kind === "audio" ? "wav" : "webm";
      const rel = `${t.kind}/${t.id}.${ext}`;
      const out = path.join(content, rel);
      await fsp.mkdir(path.dirname(out), { recursive: true });
      const dataBytes = t.chunks.reduce((n, c) => n + c.byteLength, 0);
      const ws = fs.createWriteStream(out);
      let headerBytes = 0;
      if (t.kind === "audio") {
        const header = wavHeader({ sampleRate: t.info.sampleRate, channels: 1, dataBytes });
        headerBytes = header.length;
        ws.write(header);
      }
      let offset = 0;
      const chunks = [];
      for (const c of t.chunks) {
        const buf = await fsp.readFile(path.join(this.dir, "chunks", t.id, `${pad(c.index)}.bin`));
        if (sha256(buf) !== c.sha256) throw new Error(`Chunk ${c.index} of ${t.id} changed on disk before sealing`);
        if (!ws.write(buf)) await new Promise((r) => ws.once("drain", r));
        chunks.push({
          index: c.index,
          byteOffset: headerBytes + offset,
          byteLength: c.byteLength,
          ...(t.kind === "audio" ? { sampleStart: c.sampleStart, sampleCount: c.sampleCount } : {}),
          sha256: c.sha256,
          chain: c.chain,
        });
        offset += c.byteLength;
      }
      await new Promise((resolve, reject) => ws.end((err) => (err ? reject(err) : resolve())));

      const entry = {
        id: t.id,
        role: t.role,
        kind: t.kind,
        file: rel,
        sha256: await fileDigest(out),
        bytes: headerBytes + dataBytes,
        chainGenesis: await genesis(this.sessionId, t.id),
        finalChain: t.link,
        chunks,
      };
      if (t.kind === "audio") {
        entry.audio = {
          container: "WAV",
          encoding: "IEEE float",
          bitDepth: 32,
          channels: 1,
          sampleRate: t.info.sampleRate,
          totalSamples: chunks.reduce((n, c) => n + c.sampleCount, 0),
          durationSeconds: +(chunks.reduce((n, c) => n + c.sampleCount, 0) / t.info.sampleRate).toFixed(3),
          uncompressed: true,
          processing: t.info.processing || {},
          device: t.info.device || null,
        };
      } else {
        entry.video = { ...(t.info || {}), compressed: true, note: "Video is compressed to a practical size; the WAV audio is the uncompressed master record." };
      }
      if (t.ended) entry.recording = { startedAt: t.ended.startedAt, endedAt: t.ended.endedAt };
      tracks.push(entry);
    }
    if (!tracks.some((t) => t.role === "fellow")) throw new Error("No Fellow recording to seal");

    const extras = [];
    if (context.timeline) {
      const rel = "timeline/timeline-at-interview.json";
      await fsp.mkdir(path.join(content, "timeline"), { recursive: true });
      await fsp.writeFile(path.join(content, rel), JSON.stringify(context.timeline, null, 2) + "\n");
      extras.push({ file: rel, role: "context", sha256: await fileDigest(path.join(content, rel)), note: "Snapshot of the life timeline as it stood when the interview was sealed. Context, not part of the recorded encounter." });
    }
    // The Standard's Generative Information Package keeps any AI-assisted material apart.
    await fsp.mkdir(path.join(content, "gip"), { recursive: true });
    const gipNote = "Generative Information Package\n\nThis folder holds any AI-assisted material, kept apart from the human-made record.\nThis capsule contains none: no AI was used to record, process, transcribe, summarise or edit it.\n";
    await fsp.writeFile(path.join(content, "gip", "README.txt"), gipNote);
    extras.push({ file: "gip/README.txt", role: "generative-information-package", sha256: sha256(Buffer.from(gipNote)) });
    await fsp.writeFile(path.join(content, "VERIFY.txt"), VERIFY_TEXT);
    extras.push({ file: "VERIFY.txt", role: "instructions", sha256: sha256(Buffer.from(VERIFY_TEXT)) });

    this.log("fellow", "manifest-built");
    const manifest = {
      format: FORMAT,
      capsuleId: context.capsuleId,
      createdAt: new Date().toISOString(),
      standard: {
        name: "Sondage Standard",
        commitments: ["Human Authorship", "Embodied Provenance", "Non-Custodial Sovereignty"],
        aiUsed: false,
      },
      session: context.session,
      participants: {
        fellow: { role: "Senior Fellow (primary author)", name: context.fellow.name, signingPublicKey: context.fellow.signingPublicKey, ageRecipient: context.fellow.ageRecipient },
        historian: { role: "Historian (co-author)", name: context.historian.name, signingPublicKey: context.historian.signingPublicKey },
      },
      tracks,
      files: extras,
      provenance: this.state.events,
      software: context.software || {},
      hashing: {
        algorithm: "SHA-256",
        chain: "genesis = SHA-256('sondage-capsule:' + sessionId + ':' + trackId); link[i] = SHA-256(link[i-1] + chunkSha256[i]) over lowercase hex strings",
      },
    };
    const manifestText = JSON.stringify(manifest, null, 2) + "\n";
    await fsp.writeFile(path.join(content, "manifest.json"), manifestText);
    await this.save();
    this.manifestText = manifestText;
    return { manifest, manifestText, manifestSha256: sha256(Buffer.from(manifestText)) };
  }

  // ------------------------------------------------------------ sealing

  // opts: { fellowKeys, historianSignature, historianPublicKey, vaultDir, tsaUrl|null, extraRecipients:[] }
  async seal(opts) {
    const content = this.contentDir;
    const manifestBytes = await fsp.readFile(path.join(content, "manifest.json"));
    const manifest = JSON.parse(manifestBytes);
    const manifestSha256 = sha256(manifestBytes);

    // The historian's key comes from the web app, never from the other side of the call.
    if (opts.historianPublicKey !== manifest.participants.historian.signingPublicKey) {
      throw new Error("The historian's key in the manifest does not match their registered key");
    }
    if (!keys.verify(opts.historianPublicKey, manifestBytes, opts.historianSignature)) {
      throw new Error("The historian's signature does not verify");
    }
    if (opts.fellowKeys.signingPublicKey !== manifest.participants.fellow.signingPublicKey) {
      throw new Error("This computer's key is not the Fellow key named in the manifest");
    }
    const fellowSignature = keys.sign(opts.fellowKeys, manifestBytes);
    const signatures = {
      format: FORMAT,
      signedFile: "manifest.json",
      manifestSha256,
      algorithm: "Ed25519 over the exact bytes of manifest.json",
      signatures: [
        { role: "historian", name: manifest.participants.historian.name, publicKey: opts.historianPublicKey, signature: opts.historianSignature },
        { role: "fellow", name: manifest.participants.fellow.name, publicKey: opts.fellowKeys.signingPublicKey, signature: fellowSignature, signedAt: new Date().toISOString() },
      ],
    };
    await fsp.writeFile(path.join(content, "signatures.json"), JSON.stringify(signatures, null, 2) + "\n");

    let timestamp = { status: "not-requested" };
    if (opts.tsaUrl) {
      try {
        const ts = await requestTimestamp(manifestSha256, opts.tsaUrl);
        await fsp.writeFile(path.join(content, "timestamp.tsr"), ts.tsr);
        timestamp = { status: "granted", url: ts.url, genTime: ts.genTime, file: "timestamp.tsr" };
      } catch (err) {
        timestamp = { status: "unavailable", url: opts.tsaUrl, error: String(err.message || err) };
      }
    }

    await writeOcflInventory(this.objectDir, manifest.capsuleId, {
      created: new Date().toISOString(),
      message: "Sealed Sondage capsule",
      user: { name: manifest.participants.fellow.name },
    });

    await fsp.mkdir(opts.vaultDir, { recursive: true });
    const base = `sondage-${manifest.capsuleId}`;
    const capsulePath = path.join(opts.vaultDir, `${base}.capsule.age`);
    const encrypter = new Encrypter();
    encrypter.addRecipient(opts.fellowKeys.ageRecipient);
    for (const r of opts.extraRecipients || []) encrypter.addRecipient(r);
    const tarStream = tar.c({ cwd: this.objectDir, portable: true, noMtime: false }, ["."]);
    const encrypted = await encrypter.encrypt(Readable.toWeb(Readable.from(tarStream)));
    const tmp = capsulePath + ".partial";
    await pipeline(Readable.fromWeb(encrypted), fs.createWriteStream(tmp));
    await fsp.rename(tmp, capsulePath);

    const receipt = {
      format: FORMAT,
      kind: "sondage-capsule-receipt",
      capsuleId: manifest.capsuleId,
      sealedAt: new Date().toISOString(),
      session: manifest.session,
      manifestSha256,
      capsuleFile: path.basename(capsulePath),
      capsuleSha256: await fileDigest(capsulePath),
      capsuleBytes: (await fsp.stat(capsulePath)).size,
      encryptedTo: [opts.fellowKeys.ageRecipient, ...(opts.extraRecipients || [])],
      signatures: signatures.signatures.map(({ role, name, publicKey, signature }) => ({ role, name, publicKey, signature })),
      timestamp,
      tracks: manifest.tracks.map((t) => ({ id: t.id, kind: t.kind, sha256: t.sha256, finalChain: t.finalChain, chunks: t.chunks.length })),
      note: "This receipt is not secret. It proves the capsule existed and who sealed it; only the Fellow's key can open the capsule itself.",
    };
    if (timestamp.status === "granted") {
      receipt.timestamp.tsrBase64 = (await fsp.readFile(path.join(content, "timestamp.tsr"))).toString("base64");
    }
    const receiptPath = path.join(opts.vaultDir, `${base}.receipt.json`);
    await fsp.writeFile(receiptPath, JSON.stringify(receipt, null, 2) + "\n");

    // The sealed, encrypted capsule is now the only copy; remove the plaintext staging.
    await fsp.rm(this.dir, { recursive: true, force: true });
    return { receipt, capsulePath, receiptPath };
  }
}

// ---------------------------------------------------------------- OCFL

async function listFiles(root, rel = "") {
  const out = [];
  for (const e of await fsp.readdir(path.join(root, rel), { withFileTypes: true })) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...(await listFiles(root, r)));
    else out.push(r);
  }
  return out.sort();
}

// A single-version OCFL 1.1 object: self-describing and readable without any software of ours.
export async function writeOcflInventory(objectDir, id, version) {
  const contentRoot = path.join(objectDir, "v1", "content");
  const files = await listFiles(contentRoot);
  const manifest = {};
  const state = {};
  for (const f of files) {
    const d = await fileDigest(path.join(contentRoot, f), "sha512");
    (manifest[d] ||= []).push(`v1/content/${f}`);
    (state[d] ||= []).push(f);
  }
  const inventory = {
    id: `urn:sondage:capsule:${id}`,
    type: "https://ocfl.io/1.1/spec/#inventory",
    digestAlgorithm: "sha512",
    head: "v1",
    contentDirectory: "content",
    manifest,
    versions: { v1: { created: version.created, message: version.message, user: version.user, state } },
  };
  const text = JSON.stringify(inventory, null, 2) + "\n";
  const digest = crypto.createHash("sha512").update(text).digest("hex");
  await fsp.writeFile(path.join(objectDir, "0=ocfl_object_1.1"), "ocfl_object_1.1\n");
  for (const dir of [objectDir, path.join(objectDir, "v1")]) {
    await fsp.writeFile(path.join(dir, "inventory.json"), text);
    await fsp.writeFile(path.join(dir, "inventory.json.sha512"), `${digest} inventory.json\n`);
  }
  return inventory;
}

const VERIFY_TEXT = `How to check this Sondage capsule
=================================

This folder is an OCFL 1.1 object. Everything a future reader needs is here,
in open formats, and none of it depends on Sondage still existing.

  v1/content/manifest.json    describes every file, its SHA-256, and the hash
                              chain of every recorded chunk
  v1/content/signatures.json  Ed25519 signatures of manifest.json by the Fellow
                              and the historian
  v1/content/timestamp.tsr    RFC 3161 timestamp of manifest.json (if granted)
  v1/content/audio/*.wav      the uncompressed recordings, one per person
  v1/content/gip/             the Generative Information Package (AI material,
                              kept apart; empty for this capsule)

To check it:
  1. Compute SHA-256 of each file listed in manifest.json and compare.
  2. For each track, recompute each chunk's SHA-256 from its byte range in the
     file, then rebuild the chain as described under "hashing" in manifest.json.
     The last link must equal "finalChain".
  3. Verify both signatures in signatures.json against the exact bytes of
     manifest.json, using the public keys listed there.
  4. Verify the timestamp:
       openssl ts -verify -digest <sha256 of manifest.json> -in timestamp.tsr \\
         -CAfile <the timestamp authority's CA certificate>

The Sondage verifier (sondage-verify) performs steps 1 to 3 and a structural
check of step 4 automatically.
`;
