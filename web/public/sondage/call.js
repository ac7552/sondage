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
          if (this.role === "fellow" && !this.isConnected()) await this.offer();
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

  async offer() {
    const pc = this.newPeer();
    const dc = pc.createDataChannel("sondage", { ordered: true });
    dc.onopen = () => this.onChannel(dc);
    dc.onclose = () => this.onState("channel-closed");
    await pc.setLocalDescription(await pc.createOffer());
    this.signal({ type: "offer", sdp: pc.localDescription.toJSON() });
  }

  async answer(sdp) {
    const pc = this.newPeer();
    pc.ondatachannel = (e) => {
      const dc = e.channel;
      if (dc.readyState === "open") this.onChannel(dc);
      else dc.onopen = () => this.onChannel(dc);
      dc.onclose = () => this.onState("channel-closed");
    };
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
    this.signal({ type: "bye" });
    if (this.pc) this.pc.close();
  }
}
