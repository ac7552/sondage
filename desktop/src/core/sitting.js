// Sondage Resounder, first version: naming, filing and building a Sitting's files.
//
// When a Sitting ends, the Senior Fellow's computer holds each person's raw audio
// (see capsule.js: RecordingSession stages every 10-second chunk as it arrives).
// This turns them into what Stephen's "Naming and Filing Prototype" asks for:
//
//   vault/sondage-archive/{season-key}/v1/content/03-sittings/sitting-{nn}/
//     {season-key}_sitting-{nn}_master_{date}.wav
//     {season-key}_sitting-{nn}_sitting-record_{date}.json
//
// Folder and file names are his; please don't invent new ones here.
// The master is one 32-bit float WAV with two channels: the Senior Fellow on the
// first (left), the Scholar on the second (right), so each voice stays separate
// and unprocessed. The record holds the start and end times, the duration and a
// SHA-512 digest of the master.

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { wavHeader } from "./wav.js";

// ---------------------------------------------------------------- names

const SEASON_KEY = /^\d{4}-[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function pad2(n) {
  const v = Number(n);
  if (!Number.isInteger(v) || v < 1 || v > 99) throw new Error(`Sitting number must be 1 to 99, not ${n}`);
  return String(v).padStart(2, "0");
}

// The Sitting's date in the Senior Fellow's own time zone, as YYYY-MM-DD.
export function localDate(when) {
  const d = new Date(when);
  if (Number.isNaN(d.getTime())) throw new Error(`Not a date: ${when}`);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// {season-key}_{record-type}-{nn}_{role}_{date}.{ext}
export function sittingNames({ seasonKey, sitting, date }) {
  if (!SEASON_KEY.test(seasonKey || "")) {
    throw new Error("The Season isn't set up yet (the Senior Fellow's names and Convocation year). Please call Sondage.");
  }
  const nn = pad2(sitting);
  const day = /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : localDate(date);
  const base = `${seasonKey}_sitting-${nn}`;
  return {
    folder: ["sondage-archive", seasonKey, "v1", "content", "03-sittings", `sitting-${nn}`],
    master: `${base}_master_${day}.wav`,
    record: `${base}_sitting-record_${day}.json`,
  };
}

// ---------------------------------------------------------------- reading staged audio

// Reads one person's audio, segment after segment, as a single stream of samples.
// Past the end it returns silence, so a shorter track lines up with a longer one.
class TrackReader {
  constructor(files) {
    this.files = files;
    this.index = 0;
    this.pending = new Float32Array(0);
  }

  async #more() {
    while (this.index < this.files.length) {
      const buf = await fsp.readFile(this.files[this.index++]);
      if (buf.length % 4) throw new Error(`A recorded piece has a broken length: ${this.files[this.index - 1]}`);
      if (buf.length) return new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length));
    }
    return null;
  }

  async read(n) {
    const out = new Float32Array(n);
    let filled = 0;
    while (filled < n) {
      if (this.pending.length === 0) {
        const next = await this.#more();
        if (!next) break; // the rest stays silent
        this.pending = next;
      }
      const take = Math.min(n - filled, this.pending.length);
      out.set(this.pending.subarray(0, take), filled);
      this.pending = this.pending.subarray(take);
      filled += take;
    }
    return out;
  }
}

// Only used if the two computers recorded at different rates (normally both are
// 48,000 Hz). Linear interpolation of the Scholar's track to the Senior Fellow's
// rate; the Senior Fellow's own track is never altered. The record says so.
class LinearResampler {
  constructor(reader, fromRate, toRate) {
    this.reader = reader;
    this.step = fromRate / toRate;
    this.pos = 0; // position in the source, relative to buf[0]
    this.buf = new Float32Array(0);
  }

  async read(n) {
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const need = Math.floor(this.pos) + 2;
      if (need > this.buf.length) {
        const keep = this.buf.subarray(Math.floor(this.pos));
        const more = await this.reader.read(Math.max(4096, need - this.buf.length));
        const merged = new Float32Array(keep.length + more.length);
        merged.set(keep);
        merged.set(more, keep.length);
        this.pos -= Math.floor(this.pos);
        this.buf = merged;
      }
      const j = Math.floor(this.pos);
      const f = this.pos - j;
      out[i] = this.buf[j] * (1 - f) + this.buf[j + 1] * f;
      this.pos += this.step;
    }
    return out;
  }
}

// ---------------------------------------------------------------- the master

// tracks: what RecordingSession staged. Picks each person's audio segments in order.
export function audioSegments(tracks, role) {
  const segment = (id) => Number((id.match(/-(\d+)$/) || [0, 1])[1]);
  return Object.values(tracks)
    .filter((t) => t.role === role && t.kind === "audio" && t.chunks.length > 0)
    .sort((a, b) => segment(a.id) - segment(b.id));
}

// Writes the two-channel master to `outFile` and returns its facts.
// chunkFile(track, chunk) gives the staged file for a chunk.
export async function writeMaster({ fellowTracks, scholarTracks, chunkFile, outFile }) {
  if (!fellowTracks.length) throw new Error("Nothing was recorded on this computer.");
  const rate = fellowTracks[0].info.sampleRate;
  if (fellowTracks.some((t) => t.info.sampleRate !== rate)) throw new Error("The Senior Fellow's recording changed sample rate part-way through.");
  const scholarRate = scholarTracks[0]?.info.sampleRate || rate;
  if (scholarTracks.some((t) => t.info.sampleRate !== scholarRate)) throw new Error("The Scholar's recording changed sample rate part-way through.");

  const frames = (ts) => ts.reduce((n, t) => n + t.chunks.reduce((m, c) => m + c.sampleCount, 0), 0);
  const fellowFrames = frames(fellowTracks);
  const scholarFrames = Math.round((frames(scholarTracks) * rate) / scholarRate);
  const total = Math.max(fellowFrames, scholarFrames);
  const files = (ts) => ts.flatMap((t) => t.chunks.map((c) => chunkFile(t, c)));

  const left = new TrackReader(files(fellowTracks));
  const rightRaw = new TrackReader(files(scholarTracks));
  const right = scholarRate === rate ? rightRaw : new LinearResampler(rightRaw, scholarRate, rate);

  const hash = crypto.createHash("sha512");
  const tmp = `${outFile}.partial`;
  const fh = await fsp.open(tmp, "w");
  try {
    const header = wavHeader({ sampleRate: rate, channels: 2, dataBytes: total * 8 });
    hash.update(header);
    await fh.write(header);
    const BLOCK = 48000; // about a second at a time
    for (let done = 0; done < total; done += BLOCK) {
      const n = Math.min(BLOCK, total - done);
      const [l, r] = await Promise.all([left.read(n), right.read(n)]);
      const frame = new Float32Array(n * 2);
      for (let i = 0; i < n; i++) {
        frame[2 * i] = l[i];
        frame[2 * i + 1] = r[i];
      }
      const bytes = Buffer.from(frame.buffer);
      hash.update(bytes);
      await fh.write(bytes);
    }
    await fh.sync();
  } finally {
    await fh.close();
  }
  await fsp.rename(tmp, outFile);
  return {
    sha512: hash.digest("hex"),
    sampleRate: rate,
    frames: total,
    durationSeconds: +(total / rate).toFixed(3),
    scholarResampledFrom: scholarRate === rate ? null : scholarRate,
    hasScholar: scholarTracks.length > 0,
  };
}

export async function sha512File(file) {
  const h = crypto.createHash("sha512");
  for await (const part of fs.createReadStream(file)) h.update(part);
  return h.digest("hex");
}

// ---------------------------------------------------------------- the record

// Stephen's Sitting record: start and end times, duration, SHA-512 of the master.
// It also says which channel is which, so a reader decades from now knows whose
// voice is on the left.
export function sittingRecord({ seasonKey, sitting, names, startedAt, endedAt, master }) {
  return {
    season_key: seasonKey,
    sitting: Number(sitting),
    master_file: names.master,
    started_at: new Date(startedAt).toISOString(),
    ended_at: new Date(endedAt).toISOString(),
    duration_seconds: master.durationSeconds,
    sha512: master.sha512,
    channels: {
      "1 (left)": "Senior Fellow",
      "2 (right)": master.hasScholar ? "Certified Legacy Scholar" : "Certified Legacy Scholar (nothing was received)",
    },
    audio: {
      format: "WAV, 32-bit float, uncompressed",
      sample_rate: master.sampleRate,
      ...(master.scholarResampledFrom ? { note: `The Scholar's channel was converted from ${master.scholarResampledFrom} Hz to match; the Senior Fellow's channel is unaltered.` } : {}),
    },
  };
}

// ---------------------------------------------------------------- filing

// Files the master and record under root/<folder>, never overwriting a different
// file. Returns the paths and confirms what's on disk matches what was written.
export async function fileSitting({ root, names, masterFile, record }) {
  const dir = path.join(root, ...names.folder);
  await fsp.mkdir(dir, { recursive: true });
  const masterDest = path.join(dir, names.master);
  const recordDest = path.join(dir, names.record);

  if (fs.existsSync(masterDest)) {
    if ((await sha512File(masterDest)) !== record.sha512) {
      throw new Error(`${names.master} already exists with different contents. Nothing was overwritten. Please call Sondage.`);
    }
  } else {
    await fsp.copyFile(masterFile, `${masterDest}.partial`);
    await fsp.rename(`${masterDest}.partial`, masterDest);
  }
  const text = JSON.stringify(record, null, 2) + "\n";
  await fsp.writeFile(`${recordDest}.partial`, text);
  await fsp.rename(`${recordDest}.partial`, recordDest);

  if ((await sha512File(masterDest)) !== record.sha512) throw new Error(`${names.master} didn't copy correctly.`);
  return { dir, master: masterDest, record: recordDest };
}
