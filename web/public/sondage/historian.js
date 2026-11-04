// The historian's side of the interview, in the browser.
//
// - Creates a signing key that never leaves this browser (stored as a
//   non-extractable WebCrypto key) and registers the public half.
// - Joins the peer-to-peer call with the Fellow's desktop app.
// - Records the historian's microphone raw, here, and sends each chunk straight
//   to the Fellow's computer over the call's encrypted data channel.
// - Checks the final manifest against what it recorded, byte for byte, before
//   co-signing it.

import { openRawMicrophone, describeAudioTrack, processingProblems, RawAudioRecorder, LocalVideoRecorder } from "./recorder.js";
import { ChunkSender, ChunkReceiver, wire, sendControl } from "./transfer.js";
import { InterviewCall } from "./call.js";
import { sha256Hex, genesis, nextLink } from "./chain.js";

// Shows which copy of this script is running, so an old cached copy is easy to spot.
{
  const v = (new URL(import.meta.url).pathname.match(/\/v\/([^/]+)\//) || [0, "?"])[1];
  const bar = document.querySelector(".room-bar");
  if (bar) bar.insertAdjacentHTML("beforeend", `<span class="small muted" style="margin-left:12px">build ${v.slice(0, 6)}</span>`);
}

const root = document.getElementById("room");
const cfg = root.dataset;
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const video = cfg.mediaType === "video";
const state = { micId: null, camId: null, recording: false, tracks: new Map(), sender: new ChunkSender({ onAck: () => updateSent() }) };

// ---------------------------------------------------------------- signing key

function idb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("sondage", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("keys");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function idbGet(key) {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const r = db.transaction("keys").objectStore("keys").get(key);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
async function idbPut(key, value) {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("keys", "readwrite");
    tx.objectStore("keys").put(value, key);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));

async function ensureSigningKey() {
  const slot = `historian-${cfg.userId}`;
  let pair = await idbGet(slot);
  if (!pair) {
    // The private key is created non-extractable: it can sign, but can never be read out.
    pair = await crypto.subtle.generateKey({ name: "Ed25519" }, false, ["sign", "verify"]);
    await idbPut(slot, pair);
  }
  const publicKey = b64(await crypto.subtle.exportKey("raw", pair.publicKey));
  const fp = (await sha256Hex(Uint8Array.from(atob(publicKey), (c) => c.charCodeAt(0)))).slice(0, 16).toUpperCase().match(/.{4}/g).join(" ");
  if (publicKey !== cfg.registeredKey) {
    const res = await fetch(cfg.keyUrl, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": document.querySelector('meta[name="csrf-token"]').content, Accept: "application/json" },
      body: JSON.stringify({ signing_public_key: publicKey }),
    });
    if (!res.ok) throw new Error("Couldn't register your signing key with Sondage.");
    cfg.registeredKey = publicKey;
  }
  state.key = pair;
  state.publicKey = publicKey;
  $("key-status").textContent = `Your signing key: ${fp}`;
}

// ---------------------------------------------------------------- device check

async function openCheck() {
  if (state.stream) state.stream.getTracks().forEach((t) => t.stop());
  state.stream = await openRawMicrophone(state.micId, { video, videoDeviceId: state.camId });
  const track = state.stream.getAudioTracks()[0];
  state.micId = track.getSettings().deviceId;
  if (video) {
    state.camId = state.stream.getVideoTracks()[0]?.getSettings().deviceId;
    $("preview").srcObject = state.stream;
    $("preview").hidden = false;
    $("cam-field").hidden = false;
  }
  const d = describeAudioTrack(track);
  const row = (label, v) => `<li class="${v === null ? "unknown" : v ? "bad" : ""}">${label}: ${v === null ? "not reported by this browser" : v ? "on" : "off"}</li>`;
  $("processing").innerHTML = [
    row("Echo cancellation", d.echoCancellation),
    row("Noise suppression", d.noiseSuppression),
    row("Automatic volume", d.autoGainControl),
    d.voiceIsolation !== null ? row("Voice isolation", d.voiceIsolation) : "",
    `<li>Recorded as 32-bit float${d.sampleRate ? `, ${d.sampleRate.toLocaleString()} Hz` : ""}</li>`,
  ].join("");
  state.problems = processingProblems(d);
  const devices = await navigator.mediaDevices.enumerateDevices();
  const opts = (kind, cur) => devices.filter((x) => x.kind === kind).map((x) => `<option value="${esc(x.deviceId)}" ${x.deviceId === cur ? "selected" : ""}>${esc(x.label || "Device")}</option>`).join("");
  $("mic").innerHTML = opts("audioinput", state.micId);
  $("cam").innerHTML = opts("videoinput", state.camId);
  meter(track);
  updateJoin();
}
function meter(track) {
  if (state.meterCtx) state.meterCtx.close();
  const ctx = (state.meterCtx = new AudioContext());
  const an = ctx.createAnalyser();
  an.fftSize = 1024;
  ctx.createMediaStreamSource(new MediaStream([track])).connect(an);
  const buf = new Float32Array(an.fftSize);
  const tick = () => {
    if (state.meterCtx !== ctx) return;
    an.getFloatTimeDomainData(buf);
    let p = 0;
    for (const v of buf) p = Math.max(p, Math.abs(v));
    $("meter").style.width = `${Math.min(100, Math.sqrt(p) * 100)}%`;
    requestAnimationFrame(tick);
  };
  tick();
}
function updateJoin() {
  $("join").disabled = !($("headphones").checked && state.problems?.length === 0 && state.key);
}
$("headphones").addEventListener("change", updateJoin);
$("mic").addEventListener("change", (e) => { state.micId = e.target.value; openCheck(); });
$("cam").addEventListener("change", (e) => { state.camId = e.target.value; openCheck(); });

// ---------------------------------------------------------------- the call

const fmt = (s) => [s / 3600, (s % 3600) / 60, s % 60].map((n) => String(Math.floor(n)).padStart(2, "0")).join(":");
function setConn(text, cls) {
  $("conn").textContent = text;
  $("dot").className = `dot ${cls}`;
}
function updateSent() {
  let n = 0;
  for (const t of state.tracks.values()) n += t.chunks.length;
  const pending = state.sender.pendingCount;
  $("sent").textContent = n === 0 ? "Nothing recorded yet." : `${n} piece${n === 1 ? "" : "s"} recorded · ${pending === 0 ? "all safely on the Fellow's computer" : `${pending} on the way`}`;
}

$("join").addEventListener("click", async () => {
  if (state.meterCtx) state.meterCtx.close();
  state.meterCtx = null;
  $("check").hidden = true;
  $("live").hidden = false;
  $("local").srcObject = state.stream;

  const { createConsumer } = await import(cfg.cableJs);
  const consumer = createConsumer("/cable");
  const receiver = new ChunkReceiver({ onChunk: onFellowChunk, onControl: onFellowControl });
  state.sub = consumer.subscriptions.create({ channel: "InterviewChannel", interview_id: cfg.meetingId }, {
    connected: () => state.call.start(),
    received: (msg) => state.call.handleSignal(msg),
    rejected: () => setConn("This interview is closed or sealed.", "bad"),
  });
  state.call = new InterviewCall({
    role: "historian",
    iceServers: JSON.parse(cfg.iceServers),
    relayOnly: cfg.relayOnly === "true",
    localStream: state.stream,
    signal: (msg) => state.sub.perform("signal", { payload: msg }),
    onRemoteStream: (s) => {
      $("remote").srcObject = s;
      $("remote-name").textContent = cfg.fellowName;
      voiceRing(s, $("remote-ring"));
    },
    onChannel: (dc) => {
      state.channel = dc;
      // Re-announce tracks first so a fresh connection knows every track before its chunks.
      for (const t of state.tracks.values()) sendControl(dc, { t: "track", id: t.id, kind: t.kind, info: t.info });
      wire(dc, { sender: state.sender, receiver });
      setConn("Connected, privately and directly", "live");
      // Say whether the call goes straight between the two homes or through the relay.
      setTimeout(() => state.call.route().then((r) => { if (r && dc.readyState === "open") setConn(r === "relay" ? "Connected privately, through the Sondage relay" : "Connected, privately and directly", "live"); }).catch(() => {}), 1000);
      // If the Fellow dropped out and came back mid-recording, their app picks it up again.
      sendControl(dc, { t: "historian-state", recording: !!state.recording });
      updateControls();
    },
    onState: (s) => {
      if (s === "connected") setConn(state.channel?.readyState === "open" ? "Connected, privately and directly" : "Connected. Opening the recording link…", state.channel?.readyState === "open" ? "live" : "");
      else if (s === "link-retry") setConn("Opening the recording link again…", "");
      else if (["disconnected", "failed", "channel-closed"].includes(s)) { setConn("Reconnecting… your recording continues", "bad"); updateControls(); }
      else if (s === "left") setConn(`${cfg.fellowName} left the call`, "bad");
    },
  });
  setConn(`Waiting for ${cfg.fellowName} to join…`, "");
});

async function onFellowControl(msg) {
  if (msg.t === "recording" && msg.on && !state.recording) await startRecording(msg.nextSegment || 1);
  else if (msg.t === "end") await finishRecording();
  else if (msg.t === "sealed") showDone(msg);
  else if (msg.t === "fellow-state") state.fellowRecording = msg.recording;
  updateControls();
}

// The historian runs the recording; the Fellow's app does the saving.
function updateControls() {
  const open = state.channel?.readyState === "open";
  $("h-start").hidden = state.recording || state.finished;
  $("h-start").disabled = !open || state.starting;
  const wait = $("h-wait");
  if (wait) wait.hidden = open || state.recording || state.finished;
  $("h-end").hidden = !state.recording;
  $("h-end").disabled = !open;
}
$("h-start").addEventListener("click", () => {
  state.starting = true;
  $("h-start").textContent = "Starting…";
  sendControl(state.channel, { t: "request-start" });
  updateControls();
});
$("h-end").addEventListener("click", () => {
  if (!confirm(`End the interview and save it on ${cfg.fellowName}'s computer?`)) return;
  $("h-end").disabled = true;
  $("h-end").textContent = "Saving…";
  sendControl(state.channel, { t: "request-end" });
});

function voiceRing(stream, ringEl) {
  try {
    const ctx = new AudioContext();
    const an = ctx.createAnalyser();
    an.fftSize = 512;
    ctx.createMediaStreamSource(new MediaStream(stream.getAudioTracks())).connect(an);
    const buf = new Float32Array(an.fftSize);
    const tick = () => {
      if (ctx.state === "closed") return;
      an.getFloatTimeDomainData(buf);
      let p = 0;
      for (const v of buf) p = Math.max(p, Math.abs(v));
      ringEl.style.transform = `scale(${1 + Math.min(0.35, Math.sqrt(p) * 0.6)})`;
      requestAnimationFrame(tick);
    };
    tick();
  } catch {}
}

async function startRecording(segment) {
  state.recording = true;
  state.starting = false;
  const suffix = segment > 1 ? `-${segment}` : "";
  const track = state.stream.getAudioTracks()[0];
  const d = describeAudioTrack(track);

  const audioId = `historian-audio${suffix}`;
  state.audioRec = new RawAudioRecorder(state.stream, { onChunk: (c) => sendChunk(audioId, c, { sampleStart: c.sampleStart, sampleCount: c.sampleCount }) });
  await state.audioRec.start();
  await announce(audioId, "audio", {
    sampleRate: state.audioRec.sampleRate,
    device: { label: d.label },
    processing: { echoCancellation: d.echoCancellation, noiseSuppression: d.noiseSuppression, autoGainControl: d.autoGainControl, voiceIsolation: d.voiceIsolation, deviceSampleRate: d.sampleRate, captureSampleRate: state.audioRec.sampleRate },
    browser: navigator.userAgent,
  });
  if (video) {
    const videoId = `historian-video${suffix}`;
    state.videoRec = new LocalVideoRecorder(state.stream, { onChunk: (c) => sendChunk(videoId, c, {}) });
    await announce(videoId, "video", { mimeType: state.videoRec.mimeType });
    state.videoRec.start();
  }
  const t0 = Date.now();
  state.timer = setInterval(() => ($("timer").textContent = fmt((Date.now() - t0) / 1000)), 500);
  $("rec-state").className = "rec-state on";
  $("rec-state").textContent = "Recording";
  window.onbeforeunload = () => "The interview is still recording.";
}

async function announce(id, kind, info) {
  const t = { id, kind, info, chunks: [], link: await genesis(cfg.meetingId, id) };
  state.tracks.set(id, t);
  sendControl(state.channel, { t: "track", id, kind, info });
}

async function sendChunk(trackId, c, meta) {
  const t = state.tracks.get(trackId);
  const sha256 = await sha256Hex(new Uint8Array(c.bytes));
  t.link = await nextLink(t.link, sha256);
  t.chunks.push({ index: c.index, sha256 });
  state.sender.send({ track: trackId, index: c.index, bytes: c.bytes, sha256, meta });
  updateSent();
}

async function finishRecording() {
  if (!state.recording) return;
  clearInterval(state.timer);
  $("rec-state").className = "rec-state";
  $("rec-state").textContent = "Finishing… sending the last pieces";
  const summaries = {};
  if (state.audioRec) summaries.audio = await state.audioRec.stop();
  if (state.videoRec) summaries.video = await state.videoRec.stop();
  await state.sender.drained();
  for (const t of state.tracks.values()) {
    sendControl(state.channel, { t: "track-end", id: t.id, chunks: t.chunks.length, finalChain: t.link, summary: summaries[t.kind] || {} });
  }
  state.recording = false;
  state.finished = true;
  updateControls();
  $("rec-state").textContent = `Sent. ${cfg.fellowName.split(" ")[0]}'s app is listing the files…`;
  window.onbeforeunload = null;
}

// The Fellow's app sends the manifest the same way chunks travel.
// This never waits for the historian's click (that would hold up the link), and any
// problem is sent back to the Fellow's app so it never waits in silence.
async function onFellowChunk(c) {
  if (c.track !== "manifest") throw new Error("Unexpected data from the Fellow's app");
  try {
    const bytes = new Uint8Array(c.bytes);
    const manifest = JSON.parse(new TextDecoder().decode(bytes));
    const problems = checkManifest(manifest);
    if (problems.length) {
      sendControl(state.channel, { t: "refuse", reason: `the summary didn't match this recording (${problems.join("; ")})` });
      $("rec-state").textContent = "Not signed: the summary didn't match your recording";
      return;
    }
    const tracks = manifest.tracks || [];
    const mine = tracks.filter((t) => t.role === "historian" && state.tracks.has(t.id));
    const earlier = tracks.filter((t) => t.role === "historian" && !state.tracks.has(t.id));
    const seconds = tracks.filter((t) => t.role === "fellow" && t.kind === "audio").reduce((n, t) => n + (t.audio?.durationSeconds || 0), 0);
    $("sign-facts").innerHTML = `
      <dt>Fellow</dt><dd>${esc(manifest.participants?.fellow?.name || cfg.fellowName)}</dd>
      <dt>Length</dt><dd>${seconds ? fmt(seconds) : "—"}</dd>
      <dt>Checked by this page</dt><dd>${mine.map((t) => `${esc(t.id)} (${t.chunks?.length ?? 0} pieces)`).join(", ") || "—"}</dd>
      ${earlier.length ? `<dt>Earlier parts</dt><dd>${earlier.map((t) => esc(t.id)).join(", ")}: recorded before this page was opened, so it can't check them byte for byte. Sign only if you did record them.</dd>` : ""}
      <dt>Fingerprint</dt><dd class="mono">${(await sha256Hex(bytes)).slice(0, 16).toUpperCase().match(/.{4}/g).join(" ")}</dd>`;
    state.pendingManifest = bytes; // a resend replaces it; the buttons sign whatever is newest
    $("sign").hidden = false;
    $("rec-state").textContent = "Please sign below";
    $("sign-yes").disabled = false;
    $("sign-yes").textContent = "Sign as co-author";
    $("sign-yes").focus();
    sendControl(state.channel, { t: "sign-shown" });
  } catch (err) {
    console.error(err);
    sendControl(state.channel, { t: "refuse", reason: `the interviewer's page couldn't read the summary (${err.message})` });
    $("rec-state").textContent = "Couldn't read the summary from the Fellow's app";
  }
}

$("sign-yes").addEventListener("click", async () => {
  const bytes = state.pendingManifest;
  if (!bytes) return;
  $("sign-yes").disabled = true;
  $("sign-yes").textContent = "Signing…";
  try {
    const sig = await crypto.subtle.sign({ name: "Ed25519" }, state.key.privateKey, bytes);
    if (!sendControl(state.channel, { t: "signature", signature: b64(sig), publicKey: state.publicKey })) throw new Error("The call isn't connected right now. Wait a moment and press Sign again.");
    state.pendingManifest = null;
    $("sign").hidden = true;
    $("rec-state").textContent = `Signed. Locking it on ${cfg.fellowName.split(" ")[0]}'s computer…`;
  } catch (err) {
    console.error(err);
    alert(err.message);
    $("sign-yes").disabled = false;
    $("sign-yes").textContent = "Sign as co-author";
  }
});
$("sign-no").addEventListener("click", () => {
  state.pendingManifest = null;
  $("sign").hidden = true;
  sendControl(state.channel, { t: "refuse", reason: "the interviewer chose not to sign" });
  $("rec-state").textContent = "Not signed";
});

function checkManifest(m) {
  const problems = [];
  if (String(m.session?.id) !== String(cfg.meetingId)) problems.push("it is for a different interview");
  if (m.participants?.historian?.signingPublicKey !== state.publicKey) problems.push("it names a different historian key");
  if (m.standard?.aiUsed !== false) problems.push("it doesn't declare that no AI was used");
  for (const t of state.tracks.values()) {
    const entry = m.tracks.find((x) => x.id === t.id);
    if (!entry) { problems.push(`${t.id} is missing`); continue; }
    if (entry.finalChain !== t.link) problems.push(`${t.id} doesn't end where your recording ended`);
    if (entry.chunks.length !== t.chunks.length || entry.chunks.some((c, i) => c.sha256 !== t.chunks[i].sha256)) problems.push(`${t.id} differs from what you recorded`);
  }
  return problems;
}

function showDone(msg) {
  state.tracks.clear(); // drop this browser's copy of the recording
  state.call?.close();
  state.stream?.getTracks().forEach((t) => t.stop());
  $("live").hidden = true;
  $("done").hidden = false;
  $("done-facts").innerHTML = `<dt>Capsule</dt><dd class="mono">${esc(msg.capsuleId)}</dd><dt>Fingerprint</dt><dd class="mono">${esc(msg.manifestSha256.slice(0, 16).toUpperCase().match(/.{4}/g).join(" "))}</dd>`;
}

// ---------------------------------------------------------------- start

(async () => {
  if (!window.isSecureContext) $("browser-note").textContent = "This page must be opened over https (or on localhost) to use the microphone.";
  try {
    await ensureSigningKey();
  } catch (err) {
    $("key-status").textContent = /Ed25519|not supported|NotSupported/i.test(String(err)) ? "This browser can't create a signing key. Use a current version of Chrome, Edge, Safari or Firefox." : err.message;
    console.error(err);
  }
  try {
    await openCheck();
  } catch (err) {
    $("processing").innerHTML = `<li class="bad">Couldn't open the microphone: ${esc(err.message)}</li>`;
  }
})();
