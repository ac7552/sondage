// 32-bit float WAV (IEEE float, format tag 3) — the format the Sondage Standard asks for.

export const WAV_HEADER_BYTES = 58;

export function wavHeader({ sampleRate, channels = 1, dataBytes }) {
  const b = Buffer.alloc(WAV_HEADER_BYTES);
  const frames = dataBytes / (4 * channels);
  b.write("RIFF", 0, "ascii");
  b.writeUInt32LE(WAV_HEADER_BYTES - 8 + dataBytes, 4);
  b.write("WAVE", 8, "ascii");
  b.write("fmt ", 12, "ascii");
  b.writeUInt32LE(18, 16); // fmt chunk size (with cbSize)
  b.writeUInt16LE(3, 20); // WAVE_FORMAT_IEEE_FLOAT
  b.writeUInt16LE(channels, 22);
  b.writeUInt32LE(sampleRate, 24);
  b.writeUInt32LE(sampleRate * channels * 4, 28); // byte rate
  b.writeUInt16LE(channels * 4, 32); // block align
  b.writeUInt16LE(32, 34); // bits per sample
  b.writeUInt16LE(0, 36); // cbSize
  b.write("fact", 38, "ascii");
  b.writeUInt32LE(4, 42);
  b.writeUInt32LE(frames, 46);
  b.write("data", 50, "ascii");
  b.writeUInt32LE(dataBytes, 54);
  return b;
}

// Reads just enough of a WAV header to find the samples. Works for any chunk order.
export function parseWavHeader(buf) {
  if (buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error("Not a WAV file");
  }
  let off = 12;
  const info = {};
  while (off + 8 <= buf.length) {
    const id = buf.toString("ascii", off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    if (id === "fmt ") {
      info.format = buf.readUInt16LE(off + 8);
      info.channels = buf.readUInt16LE(off + 10);
      info.sampleRate = buf.readUInt32LE(off + 12);
      info.bitsPerSample = buf.readUInt16LE(off + 22);
    } else if (id === "data") {
      info.dataOffset = off + 8;
      info.dataBytes = size;
      return info;
    }
    off += 8 + size + (size % 2);
  }
  throw new Error("WAV has no data chunk");
}
