// Sondage raw recorder — shared by the desktop app (Fellow) and the browser (historian).
//
// The live call is only for talking. This records the microphone separately and
// raw: every processing stage the browser offers is switched off, the audio is
// captured as 32-bit float samples at the device's own sample rate, and it is
// handed over in fixed-length chunks so a crash loses at most one chunk.

import { CHUNK_SECONDS } from "./chain.js";

// Constraints that turn off every built-in processing stage we can reach.
export const RAW_AUDIO_CONSTRAINTS = {
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: false,
  voiceIsolation: false, // newer Chromium; ignored where unsupported
  channelCount: 1,
};

export async function openRawMicrophone(deviceId, { video = false, videoDeviceId } = {}) {
  const audio = { ...RAW_AUDIO_CONSTRAINTS };
  if (deviceId) audio.deviceId = { exact: deviceId };
  const constraints = { audio };
  if (video) {
    constraints.video = {
      width: { ideal: 1920 },
      height: { ideal: 1080 },
      frameRate: { ideal: 30 },
    };
    if (videoDeviceId) constraints.video.deviceId = { exact: videoDeviceId };
  }
  const stream = await navigator.mediaDevices.getUserMedia(constraints);
  return stream;
}

// What the browser actually applied — goes into the manifest and the device check.
export function describeAudioTrack(track) {
  const s = track.getSettings();
  return {
    label: track.label || "Unknown microphone",
    deviceId: s.deviceId || null,
    sampleRate: s.sampleRate || null,
    channelCount: s.channelCount || null,
    echoCancellation: s.echoCancellation ?? null,
    noiseSuppression: s.noiseSuppression ?? null,
    autoGainControl: s.autoGainControl ?? null,
    voiceIsolation: s.voiceIsolation ?? null,
  };
}

// Returns a list of problems; empty means the track is raw.
export function processingProblems(settings) {
  const problems = [];
  if (settings.echoCancellation === true) problems.push("Echo cancellation is on");
  if (settings.noiseSuppression === true) problems.push("Noise suppression is on");
  if (settings.autoGainControl === true) problems.push("Automatic gain control is on");
  if (settings.voiceIsolation === true) problems.push("Voice isolation is on");
  return problems;
}

// The AudioWorklet runs on the audio thread and copies samples out untouched.
const WORKLET_SOURCE = `
class SondageCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buf = new Float32Array(4800);
    this.n = 0;
    this.port.onmessage = (e) => { if (e.data === 'flush') this.flush(); };
  }
  flush() {
    if (this.n > 0) {
      const out = this.buf.slice(0, this.n);
      this.port.postMessage(out, [out.buffer]);
      this.n = 0;
    }
    this.port.postMessage('flushed');
  }
  process(inputs) {
    const input = inputs[0];
    const ch = input && input.length ? input[0] : null;
    const frames = ch ? ch.length : 128;
    for (let i = 0; i < frames; i++) {
      this.buf[this.n++] = ch ? ch[i] : 0; // keep time even if the input drops
      if (this.n === this.buf.length) {
        const out = this.buf;
        this.port.postMessage(out, [out.buffer]);
        this.buf = new Float32Array(4800);
        this.n = 0;
      }
    }
    return true;
  }
}
registerProcessor('sondage-capture', SondageCapture);
`;

export class RawAudioRecorder {
  // onChunk({ index, sampleStart, sampleCount, bytes: ArrayBuffer }) — may be async
  constructor(stream, { onChunk, chunkSeconds = CHUNK_SECONDS, onLevel } = {}) {
    this.stream = stream;
    this.track = stream.getAudioTracks()[0];
    this.onChunk = onChunk;
    this.onLevel = onLevel;
    this.chunkSeconds = chunkSeconds;
    this.index = 0;
    this.samplesWritten = 0;
    this.pending = [];
    this.pendingSamples = 0;
    this.queue = Promise.resolve();
  }

  async start() {
    const settings = this.track.getSettings();
    // Match the device's own rate so the browser does not resample.
    const opts = settings.sampleRate ? { sampleRate: settings.sampleRate } : {};
    this.ctx = new AudioContext({ latencyHint: "interactive", ...opts });
    this.sampleRate = this.ctx.sampleRate;
    this.chunkSamples = Math.round(this.sampleRate * this.chunkSeconds);

    const url = URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: "text/javascript" }));
    await this.ctx.audioWorklet.addModule(url);
    URL.revokeObjectURL(url);

    this.source = this.ctx.createMediaStreamSource(new MediaStream([this.track]));
    this.node = new AudioWorkletNode(this.ctx, "sondage-capture", {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      channelCount: 1,
      channelCountMode: "explicit",
      channelInterpretation: "discrete",
    });
    // The node must be pulled by the graph to run; a zero-gain sink plays nothing.
    this.sink = this.ctx.createGain();
    this.sink.gain.value = 0;
    this.source.connect(this.node);
    this.node.connect(this.sink);
    this.sink.connect(this.ctx.destination);

    this.flushed = null;
    this.node.port.onmessage = (e) => {
      if (e.data === "flushed") {
        if (this.flushed) this.flushed();
        return;
      }
      this.accept(e.data);
    };
    this.startedAt = new Date().toISOString();
    if (this.ctx.state !== "running") await this.ctx.resume();
  }

  accept(frame) {
    if (this.onLevel) {
      let peak = 0;
      for (let i = 0; i < frame.length; i++) peak = Math.max(peak, Math.abs(frame[i]));
      this.onLevel(peak);
    }
    this.pending.push(frame);
    this.pendingSamples += frame.length;
    while (this.pendingSamples >= this.chunkSamples) this.emit(this.chunkSamples);
  }

  emit(count) {
    const out = new Float32Array(count);
    let filled = 0;
    while (filled < count) {
      const head = this.pending[0];
      const take = Math.min(head.length, count - filled);
      out.set(head.subarray(0, take), filled);
      filled += take;
      if (take === head.length) this.pending.shift();
      else this.pending[0] = head.subarray(take);
    }
    this.pendingSamples -= count;
    const chunk = {
      index: this.index++,
      sampleStart: this.samplesWritten,
      sampleCount: count,
      bytes: out.buffer,
    };
    this.samplesWritten += count;
    // Chunks are delivered strictly in order, one at a time.
    this.queue = this.queue.then(() => this.onChunk(chunk));
  }

  async stop() {
    if (!this.node) return this.summary();
    await new Promise((resolve) => {
      this.flushed = resolve;
      this.node.port.postMessage("flush");
    });
    if (this.pendingSamples > 0) this.emit(this.pendingSamples);
    await this.queue;
    this.source.disconnect();
    this.node.disconnect();
    this.sink.disconnect();
    await this.ctx.close();
    this.node = null;
    this.endedAt = new Date().toISOString();
    return this.summary();
  }

  summary() {
    return {
      chunks: this.index,
      totalSamples: this.samplesWritten,
      sampleRate: this.sampleRate,
      startedAt: this.startedAt,
      endedAt: this.endedAt,
    };
  }
}

// Video is recorded locally too. It has to be compressed to be a practical size,
// so the manifest labels it as compressed; the WAV audio stays the master record.
export class LocalVideoRecorder {
  constructor(stream, { onChunk, chunkSeconds = CHUNK_SECONDS } = {}) {
    const videoTrack = stream.getVideoTracks()[0];
    this.stream = new MediaStream([videoTrack]);
    this.track = videoTrack;
    this.onChunk = onChunk;
    this.chunkSeconds = chunkSeconds;
    this.index = 0;
    this.queue = Promise.resolve();
    const candidates = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"];
    this.mimeType = candidates.find((t) => MediaRecorder.isTypeSupported(t)) || "";
  }

  start() {
    this.recorder = new MediaRecorder(this.stream, {
      mimeType: this.mimeType,
      videoBitsPerSecond: 8_000_000,
    });
    this.recorder.ondataavailable = (e) => {
      if (!e.data || e.data.size === 0) return;
      const index = this.index++;
      this.queue = this.queue.then(async () =>
        this.onChunk({ index, bytes: await e.data.arrayBuffer() })
      );
    };
    this.startedAt = new Date().toISOString();
    this.recorder.start(this.chunkSeconds * 1000);
  }

  async stop() {
    if (!this.recorder || this.recorder.state === "inactive") return this.summary();
    await new Promise((resolve) => {
      this.recorder.onstop = resolve;
      this.recorder.stop();
    });
    // ondataavailable fires before onstop; wait for the queue to drain.
    await new Promise((r) => setTimeout(r, 0));
    await this.queue;
    this.endedAt = new Date().toISOString();
    return this.summary();
  }

  summary() {
    const s = this.track.getSettings();
    return {
      chunks: this.index,
      mimeType: this.mimeType,
      width: s.width || null,
      height: s.height || null,
      frameRate: s.frameRate || null,
      label: this.track.label,
      startedAt: this.startedAt,
      endedAt: this.endedAt,
    };
  }
}
