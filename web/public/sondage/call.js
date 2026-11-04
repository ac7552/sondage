// The live interview call: one peer-to-peer WebRTC connection between the
// Fellow's desktop app and the historian's browser. The web app only relays the
// introductions (offer, answer, network candidates); audio, video and the
// recording chunks travel directly between the two devices, encrypted.
//
// The Fellow always makes the offer, so reconnection has one clear owner.

export class InterviewCall {
  constructor({ role, iceServers, localStream, signal, onRemoteStream, onChannel, onState }) {
    this.role = role; // "fellow" | "historian"
    this.iceServers = iceServers || [];
    this.localStream = localStream;
    this.signal = (msg) => signal({ ...msg, from: role });
    this.onRemoteStream = onRemoteStream || (() => {});
    this.onChannel = onChannel || (() => {});
    this.onState = onState || (() => {});
    this.pc = null;
    this.pendingIce = [];
    this.closed = false;
    this.dc = null;
    this.offeredAt = 0;
  }

  start() {
    // Whoever arrives second triggers the offer.
    this.signal({ type: this.role === "fellow" ? "ping" : "ready" });
  }

  async handleSignal(msg) {
    if (this.closed || msg.from === this.role) return;
    try {
      switch (msg.type) {
        case "ping":
          if (this.role === "historian") this.signal({ type: "ready" });
          break;
        case "ready":
          // Offer when there is no working call, or the call has no recording link.
          // An offer already on its way is not replaced (two "ready"s can arrive together).
          if (this.role !== "fellow") break;
          if (this.pc?.signalingState === "have-local-offer" && Date.now() - this.offeredAt < 5000) break;
          if (!this.isConnected() || !this.channelOpen()) await this.offer();
          break;
        case "offer":
          if (this.role === "historian") await this.answer(msg.sdp);
          break;
        case "answer":
          if (this.role === "fellow" && this.pc) {
            await this.pc.setRemoteDescription(msg.sdp);
            await this.flushIce();
          }
          break;
        case "ice":
          if (this.pc && this.pc.remoteDescription) await this.pc.addIceCandidate(msg.candidate).catch(() => {});
          else this.pendingIce.push(msg.candidate);
          break;
        case "bye":
          this.onState("left");
          break;
      }
    } catch (err) {
      console.error("signal error", err);
      this.onState("error", err);
    }
  }

  channelOpen() {
    return this.dc?.readyState === "open";
  }

  isConnected() {
    return this.pc && ["connected", "connecting"].includes(this.pc.connectionState);
  }

  newPeer() {
    if (this.pc) this.pc.close();
    this.pendingIce = [];
    const pc = new RTCPeerConnection({ iceServers: this.iceServers });
    this.pc = pc;
    for (const track of this.localStream.getTracks()) pc.addTrack(track, this.localStream);
    pc.onicecandidate = (e) => e.candidate && this.signal({ type: "ice", candidate: e.candidate.toJSON() });
    pc.ontrack = (e) => this.onRemoteStream(e.streams[0]);
    pc.onconnectionstatechange = () => {
      if (pc !== this.pc) return;
      this.onState(pc.connectionState);
      if (pc.connectionState === "failed") this.recover();
      if (pc.connectionState === "connected") this.watchLink(pc);
    };
    return pc;
  }

  recover() {
    if (this.closed) return;
    setTimeout(() => {
      if (this.closed || this.isConnected()) return;
      if (this.role === "fellow") this.offer();
      else this.signal({ type: "ready" });
    }, 1500);
  }

  // Sound and picture can work while the recording link (data channel) does not.
  // If the link hasn't opened a few seconds after connecting, ask for a fresh start.
  watchLink(pc) {
    clearTimeout(this.linkTimer);
    this.linkTimer = setTimeout(() => {
      if (this.closed || pc !== this.pc || this.channelOpen()) return;
      console.warn("Sondage: call connected but the recording link did not open; reconnecting");
      this.onState("link-retry");
      if (this.role === "fellow") this.offer();
      else this.signal({ type: "ready" });
    }, 6000);
  }

  useChannel(dc) {
    this.dc = dc;
    dc.onopen = () => { if (this.dc === dc) this.onChannel(dc); };
    dc.onclose = () => { if (this.dc === dc) this.onState("channel-closed"); };
    if (dc.readyState === "open") this.onChannel(dc);
  }

  async offer() {
    const pc = this.newPeer();
    this.offeredAt = Date.now();
    this.useChannel(pc.createDataChannel("sondage", { ordered: true }));
    await pc.setLocalDescription(await pc.createOffer());
    this.signal({ type: "offer", sdp: pc.localDescription.toJSON() });
  }

  async answer(sdp) {
    const pc = this.newPeer();
    pc.ondatachannel = (e) => { if (pc === this.pc) this.useChannel(e.channel); };
    await pc.setRemoteDescription(sdp);
    await this.flushIce();
    await pc.setLocalDescription(await pc.createAnswer());
    this.signal({ type: "answer", sdp: pc.localDescription.toJSON() });
  }

  async flushIce() {
    const queued = this.pendingIce;
    this.pendingIce = [];
    for (const c of queued) await this.pc.addIceCandidate(c).catch(() => {});
  }

  close() {
    this.closed = true;
    clearTimeout(this.linkTimer);
    this.signal({ type: "bye" });
    if (this.pc) this.pc.close();
  }
}
