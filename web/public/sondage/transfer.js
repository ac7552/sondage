// Moves recorded chunks between the two people over the call's own encrypted
// data channel. Nothing passes through Sondage servers.
//
// Wire format (one ordered, reliable RTCDataChannel named "sondage"):
//   JSON  {t:"chunk", track, index, byteLength, sha256, meta}   followed by raw bytes in parts
//   JSON  {t:"ack", track, index, ok, reason?}                  confirms a chunk was stored
//   JSON  {t:"..."}                                             any other control message
//
// The historian sends recording chunks to the Fellow; the Fellow sends the
// manifest back the same way (it can be larger than one channel message).

import { sha256Hex } from "./chain.js";

const PART = 16 * 1024; // safe message size across browsers
const HIGH_WATER = 1 * 1024 * 1024;

export class ChunkSender {
  constructor({ onAck, shouldRetry } = {}) {
    this.channel = null;
    this.shouldRetry = shouldRetry || (() => true);
    this.unacked = new Map(); // key -> chunk
    this.order = [];
    this.onAck = onAck;
    this.sending = Promise.resolve();
  }

  key(track, index) {
    return `${track}#${index}`;
  }

  attach(channel) {
    this.channel = channel;
    // Anything never confirmed is sent again on a fresh channel.
    for (const k of this.order) {
      const c = this.unacked.get(k);
      if (c) this.sending = this.sending.then(() => this.transmit(c));
    }
  }

  handle(msg) {
    if (msg.t !== "ack") return false;
    const k = this.key(msg.track, msg.index);
    if (msg.ok) {
      this.unacked.delete(k);
      this.order = this.order.filter((x) => x !== k);
    } else if (!this.shouldRetry(msg)) {
      // The other side read it and said no: sending it again won't help.
      this.unacked.delete(k);
      this.order = this.order.filter((x) => x !== k);
    } else {
      const c = this.unacked.get(k);
      if (c) this.sending = this.sending.then(() => this.transmit(c)); // try again
    }
    if (this.onAck) this.onAck(msg, this.unacked.size);
    return true;
  }

  // chunk = { track, index, bytes: ArrayBuffer, sha256, meta }
  send(chunk) {
    const k = this.key(chunk.track, chunk.index);
    if (!this.unacked.has(k)) this.order.push(k);
    this.unacked.set(k, chunk);
    this.sending = this.sending.then(() => this.transmit(chunk));
    return this.sending;
  }

  async transmit(chunk) {
    const ch = this.channel;
    if (!ch || ch.readyState !== "open") return; // resent on next attach()
    ch.send(
      JSON.stringify({
        t: "chunk",
        track: chunk.track,
        index: chunk.index,
        byteLength: chunk.bytes.byteLength,
        sha256: chunk.sha256,
        meta: chunk.meta || {},
      })
    );
    const view = new Uint8Array(chunk.bytes);
    for (let off = 0; off < view.length; off += PART) {
      if (ch.readyState !== "open") return;
      if (ch.bufferedAmount > HIGH_WATER) {
        await new Promise((resolve) => {
          const done = () => {
            ch.removeEventListener("bufferedamountlow", done);
            resolve();
          };
          ch.addEventListener("bufferedamountlow", done);
        });
      }
      ch.send(view.slice(off, Math.min(off + PART, view.length)));
    }
  }

  get pendingCount() {
    return this.unacked.size;
  }

  async drained(timeoutMs = 120000) {
    const start = Date.now();
    while (this.unacked.size > 0) {
      if (Date.now() - start > timeoutMs) throw new Error("Timed out sending recorded chunks");
      await new Promise((r) => setTimeout(r, 250));
    }
  }
}

export class ChunkReceiver {
  // onChunk({track, index, bytes, sha256, meta}) must persist and resolve; a rejection is a failed ack.
  // onControl(msg) receives every other message, in order with the chunks.
  constructor({ onChunk, onControl }) {
    this.onChunk = onChunk;
    this.onControl = onControl;
    this.current = null;
    this.queue = Promise.resolve();
  }

  attach(channel) {
    this.channel = channel;
    this.current = null;
  }

  receive(data) {
    if (typeof data === "string") {
      const msg = JSON.parse(data);
      if (msg.t === "chunk") {
        this.current = { ...msg, parts: [], received: 0 };
        if (msg.byteLength === 0) this.complete();
      } else if (this.onControl) {
        this.queue = this.queue.then(() => this.onControl(msg)).catch((e) => console.error(e));
      }
      return;
    }
    if (!this.current) return;
    this.current.parts.push(new Uint8Array(data));
    this.current.received += data.byteLength;
    if (this.current.received >= this.current.byteLength) this.complete();
  }

  complete() {
    const c = this.current;
    this.current = null;
    this.queue = this.queue.then(async () => {
      const bytes = new Uint8Array(c.byteLength);
      let off = 0;
      for (const p of c.parts) {
        bytes.set(p, off);
        off += p.length;
      }
      const ack = { t: "ack", track: c.track, index: c.index, ok: true };
      try {
        const actual = await sha256Hex(bytes);
        if (actual !== c.sha256) throw new Error("hash mismatch in transit");
        await this.onChunk({ track: c.track, index: c.index, bytes: bytes.buffer, sha256: c.sha256, meta: c.meta });
      } catch (err) {
        ack.ok = false;
        ack.reason = String(err.message || err);
      }
      if (this.channel && this.channel.readyState === "open") this.channel.send(JSON.stringify(ack));
    });
  }
}

// One listener per channel: acks go to the sender, everything else to the receiver.
export function wire(channel, { sender, receiver }) {
  channel.binaryType = "arraybuffer";
  channel.bufferedAmountLowThreshold = 256 * 1024;
  receiver.attach(channel);
  channel.addEventListener("message", (e) => {
    if (typeof e.data === "string") {
      const msg = JSON.parse(e.data);
      if (msg.t === "ack") {
        sender.handle(msg);
        return;
      }
    }
    receiver.receive(e.data);
  });
  sender.attach(channel);
}

export function sendControl(channel, msg) {
  if (!channel || channel.readyState !== "open") return false;
  channel.send(JSON.stringify(msg));
  return true;
}
