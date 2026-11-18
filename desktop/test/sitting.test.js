import { test } from "node:test";
import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { sittingNames, writeMaster, sittingRecord, fileSitting, sha512File, audioSegments, pad2 } from "../src/core/sitting.js";
import { parseWavHeader } from "../src/core/wav.js";

test("names follow Stephen's example exactly", () => {
  const n = sittingNames({ seasonKey: "2027-alvarez-maria", sitting: 3, date: "2027-02-02" });
  assert.equal(n.master, "2027-alvarez-maria_sitting-03_master_2027-02-02.wav");
  assert.equal(n.record, "2027-alvarez-maria_sitting-03_sitting-record_2027-02-02.json");
  assert.equal(n.folder.join("/"), "sondage-archive/2027-alvarez-maria/v1/content/03-sittings/sitting-03");
  for (const name of [n.master, n.record, ...n.folder]) assert.match(name, /^[a-z0-9_.-]+$/);
});

test("a missing or malformed Season, or a bad Sitting number, is refused", () => {
  assert.throws(() => sittingNames({ seasonKey: null, sitting: 1, date: "2027-02-02" }), /Season isn't set up/);
  assert.throws(() => sittingNames({ seasonKey: "2027-Alvarez-María", sitting: 1, date: "2027-02-02" }), /Season isn't set up/);
  assert.throws(() => pad2(0), /1 to 99/);
  assert.equal(pad2(12), "12");
});

async function stage(dir, name, samples) {
  const file = path.join(dir, name);
  await fsp.writeFile(file, Buffer.from(Float32Array.from(samples).buffer));
  return file;
}
const track = (id, role, rate, chunks) => ({ id, role, kind: "audio", info: { sampleRate: rate }, chunks: chunks.map((c, i) => ({ index: i, sampleCount: c.length, file: c.file })) });

test("the master puts the Senior Fellow on the left and the Scholar on the right, raw", async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "sitting-"));
  const f1 = Array.from({ length: 1000 }, (_, i) => i / 1000);
  const f2 = Array.from({ length: 1000 }, (_, i) => -i / 1000);
  const s1 = Array.from({ length: 1500 }, (_, i) => 0.5);
  const fellow = track("fellow-audio", "fellow", 48000, [{ length: 1000, file: await stage(dir, "f1", f1) }, { length: 1000, file: await stage(dir, "f2", f2) }]);
  const scholar = track("historian-audio", "historian", 48000, [{ length: 1500, file: await stage(dir, "s1", s1) }]);
  const out = path.join(dir, "master.wav");
  const m = await writeMaster({ fellowTracks: [fellow], scholarTracks: [scholar], chunkFile: (_t, c) => c.file, outFile: out });

  assert.equal(m.frames, 2000);
  assert.equal(m.sha512, await sha512File(out));
  const buf = await fsp.readFile(out);
  const h = parseWavHeader(buf);
  assert.deepEqual([h.format, h.channels, h.bitsPerSample, h.sampleRate, h.dataBytes], [3, 2, 32, 48000, 2000 * 8]);
  const s = new Float32Array(buf.buffer.slice(buf.byteOffset + h.dataOffset, buf.byteOffset + h.dataOffset + h.dataBytes));
  assert.equal(s[2 * 500], Math.fround(0.5)); // left: Senior Fellow, unaltered
  assert.equal(s[2 * 1500], Math.fround(-0.5)); // second piece follows the first
  assert.equal(s[2 * 10 + 1], 0.5); // right: Scholar
  assert.equal(s[2 * 1700 + 1], 0); // the Scholar's shorter track is padded with silence
});

test("a Scholar recorded at another rate is converted; the Senior Fellow never is", async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "sitting-"));
  const fellow = track("fellow-audio", "fellow", 48000, [{ length: 960, file: await stage(dir, "f", Array(960).fill(0.25)) }]);
  const scholar = track("historian-audio", "historian", 24000, [{ length: 480, file: await stage(dir, "s", Array(480).fill(0.75)) }]);
  const m = await writeMaster({ fellowTracks: [fellow], scholarTracks: [scholar], chunkFile: (_t, c) => c.file, outFile: path.join(dir, "m.wav") });
  assert.equal(m.frames, 960);
  assert.equal(m.scholarResampledFrom, 24000);
  const rec = sittingRecord({ seasonKey: "2027-alvarez-maria", sitting: 3, names: sittingNames({ seasonKey: "2027-alvarez-maria", sitting: 3, date: "2027-02-02" }), startedAt: "2027-02-02T19:00:00Z", endedAt: "2027-02-02T19:20:00Z", master: m });
  assert.match(rec.audio.note, /converted from 24000 Hz/);
});

test("segments are ordered, and filing never overwrites a different master", async () => {
  const order = audioSegments({
    a: { id: "fellow-audio-2", role: "fellow", kind: "audio", chunks: [1] },
    b: { id: "fellow-audio", role: "fellow", kind: "audio", chunks: [1] },
    c: { id: "historian-audio", role: "historian", kind: "audio", chunks: [1] },
    d: { id: "fellow-video", role: "fellow", kind: "video", chunks: [1] },
  }, "fellow").map((t) => t.id);
  assert.deepEqual(order, ["fellow-audio", "fellow-audio-2"]);

  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "sitting-"));
  const fellow = track("fellow-audio", "fellow", 48000, [{ length: 100, file: await stage(dir, "f", Array(100).fill(0.1)) }]);
  const master = await writeMaster({ fellowTracks: [fellow], scholarTracks: [], chunkFile: (_t, c) => c.file, outFile: path.join(dir, "m.wav") });
  const names = sittingNames({ seasonKey: "2027-alvarez-maria", sitting: 1, date: "2027-02-02" });
  const record = sittingRecord({ seasonKey: "2027-alvarez-maria", sitting: 1, names, startedAt: "2027-02-02T19:00:00Z", endedAt: "2027-02-02T19:20:00Z", master });
  const root = path.join(dir, "vault");
  const placed = await fileSitting({ root, names, masterFile: path.join(dir, "m.wav"), record });
  assert.equal(placed.master, path.join(root, "sondage-archive/2027-alvarez-maria/v1/content/03-sittings/sitting-01/2027-alvarez-maria_sitting-01_master_2027-02-02.wav"));
  const saved = JSON.parse(await fsp.readFile(placed.record, "utf8"));
  assert.equal(saved.sha512, await sha512File(placed.master));
  assert.equal(saved.duration_seconds, +(100 / 48000).toFixed(3));
  assert.equal(saved.channels["1 (left)"], "Senior Fellow");

  await fileSitting({ root, names, masterFile: path.join(dir, "m.wav"), record }); // same again: fine
  const other = await writeMaster({ fellowTracks: [track("fellow-audio", "fellow", 48000, [{ length: 100, file: await stage(dir, "g", Array(100).fill(0.9)) }])], scholarTracks: [], chunkFile: (_t, c) => c.file, outFile: path.join(dir, "m2.wav") });
  await assert.rejects(fileSitting({ root, names, masterFile: path.join(dir, "m2.wav"), record: { ...record, sha512: other.sha512 } }), /already exists with different contents/);
});
