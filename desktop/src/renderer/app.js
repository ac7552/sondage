// Sondage desktop — the window. Written for people who find technology hard:
// one step per screen, plain words, big buttons. Everything sensitive (keys, files,
// sealing) happens in the main process.

import { createConsumer } from "../../node_modules/@rails/actioncable/app/assets/javascripts/actioncable.esm.js";
import { openRawMicrophone, describeAudioTrack, processingProblems, RawAudioRecorder, LocalVideoRecorder } from "../shared/recorder.js";
import { ChunkSender, ChunkReceiver, wire, sendControl } from "../shared/transfer.js";
import { InterviewCall } from "../shared/call.js";
import { sha256Hex } from "../shared/chain.js";
import { mountTimeline } from "../shared/timeline.js";

const S = window.sondage;
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const first = (name) => String(name || "").trim().split(/\s+/)[0] || "";
const initials = (name) => String(name || "").replace(/^(Dr|Mr|Mrs|Ms|Prof)\.?\s+/i, "").split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
const longDate = (iso) => new Date(iso).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
const longTime = (iso) => new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
const state = { config: null, me: null, keys: null, setup: null, room: null };

// ---------------------------------------------------------------- navigation

function show(name) {
  $$(".view").forEach((v) => (v.hidden = v.id !== `view-${name}`));
  $("#nav").hidden = !["home", "vault", "settings", "listen", "story"].includes(name);
  window.scrollTo(0, 0);
  const h = $(`#view-${name} h1`);
  if (h) { h.tabIndex = -1; h.focus({ preventScroll: true }); }
}
document.addEventListener("click", (e) => {
  const go = e.target.closest("[data-go]");
  if (!go) return;
  stopListening();
  ({ home: loadHome, vault: loadVault, settings: loadSettings, story: loadStory })[go.dataset.go]?.();
});

async function boot() {
  state.config = await S.config.get();
  if (!state.config.signedIn) {
    $("#server-url").value = state.config.serverUrl;
    return show("signin");
  }
  state.keys = await S.keys.status();
  const me = (state.me = await S.api("GET", "/api/v1/me").catch(() => null));
  const registered = me?.fellow?.signing_public_key;
  if (!state.keys.hasKeys) return registered ? startRestore() : startSetup();
  // Setup was interrupted before the helpers were saved.
  if (me?.fellow && (!registered || (registered === state.keys.signingPublicKey && !me.fellow.safety_contacts?.length))) return startSetup();
  await loadHome();
}

// ---------------------------------------------------------------- sign in

$("#signin-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = e.target;
  const err = $("#signin-error");
  err.hidden = true;
  try {
    await S.auth.signIn({ serverUrl: $("#server-url").value, email: f.email.value, password: f.password.value });
    f.password.value = "";
    await boot();
  } catch (ex) {
    err.textContent = /fetch failed|ECONNREFUSED|ENOTFOUND/.test(ex.message) ? "We can't reach Sondage right now. Check that the internet is on, then try again." : ex.message;
    err.hidden = false;
  }
});

// ---------------------------------------------------------------- setup: keep recordings safe

const SETUP_STEPS = { you: 1, helper1: 2, helper2: 3, send: 4, done: 5 };

function setupStep(name) {
  show("setup");
  $$("#view-setup .step").forEach((s) => (s.hidden = s.dataset.step !== name));
  $("#setup-count").textContent = SETUP_STEPS[name] ? `Step ${SETUP_STEPS[name]} of 5` : "";
  const h = $(`#view-setup .step[data-step="${name}"] h1`);
  if (h) { h.tabIndex = -1; h.focus({ preventScroll: true }); }
  $(`#view-setup .step[data-step="${name}"] input`)?.focus();
}

function startSetup() {
  state.setup = { email: state.config.user?.email || "", helpers: [] };
  setupStep("intro");
}

$('#view-setup .step[data-step="intro"] [data-next]').addEventListener("click", () => {
  $("#you-email").textContent = state.setup.email;
  $("#you-edit").hidden = true;
  setupStep("you");
});
$("#you-change").addEventListener("click", () => {
  $("#you-edit").hidden = false;
  $("#you-email-input").value = state.setup.email;
  $("#you-email-input").focus();
});
$('#view-setup .step[data-step="you"] [data-next]').addEventListener("click", () => {
  if (!$("#you-edit").hidden && $("#you-email-input").value.trim()) state.setup.email = $("#you-email-input").value.trim();
  setupStep("helper1");
});

$$("#view-setup form[data-helper]").forEach((form) =>
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const n = +form.dataset.helper;
    const problem = $(".problem", form);
    problem.hidden = true;
    const helper = { name: form.name.value.trim(), email: form.email.value.trim() };
    const used = [state.setup.email, ...state.setup.helpers.slice(0, n - 1).map((h) => h.email)].map((x) => x.toLowerCase());
    if (used.includes(helper.email.toLowerCase())) {
      problem.textContent = "That email is already used. Please type a different person's email.";
      problem.hidden = false;
      return;
    }
    state.setup.helpers[n - 1] = helper;
    if (n === 1) {
      $(".helper1-name").textContent = helper.name;
      return setupStep("helper2");
    }
    // Both helpers chosen: make the safety copies and tell Sondage who holds them.
    const btn = $('button[type="submit"]', form);
    btn.disabled = true;
    btn.textContent = "One moment…";
    try {
      if (!(await S.keys.status()).hasKeys) await S.keys.create();
      await S.keys.register([
        { name: state.config.user?.name || "Me", email: state.setup.email, role: "self" },
        { ...state.setup.helpers[0], role: "family" },
        { ...state.setup.helpers[1], role: "family" },
      ]);
      state.keys = await S.keys.status();
      startSending([1, 2, 0]);
    } catch (ex) {
      problem.textContent = ex.message;
      problem.hidden = false;
    }
    btn.disabled = false;
    btn.textContent = "Next";
  })
);

// Each safety email is opened in the person's own email app, one at a time.
async function startSending(order) {
  const contacts = await S.keys.contacts();
  state.sending = { order, at: 0, contacts };
  showSend();
}
function showSend() {
  const { order, at, contacts } = state.sending;
  const c = contacts[order[at]];
  const who = c.role === "self" ? "yourself" : first(c.name);
  $("#send-title").textContent = c.role === "self" ? `Last one: an email to yourself` : `Now we will email ${first(c.name)}`;
  $("#send-open").textContent = c.role === "self" ? "Open the email to myself" : `Open the email to ${first(c.name)}`;
  $("#send-check").hidden = true;
  $("#setup-count").textContent = `Step 4 of 5 · Email ${at + 1} of ${order.length}`;
  setupStep("send");
  $("#setup-count").textContent = `Step 4 of 5 · Email ${at + 1} of ${order.length}`;
  void who;
}
async function openMail() {
  const { order, at } = state.sending;
  await S.keys.mail(order[at], state.config.user?.name || "");
  $("#send-check").hidden = false;
}
$("#send-open").addEventListener("click", openMail);
$("#send-again").addEventListener("click", openMail);
$("#send-yes").addEventListener("click", () => {
  state.sending.at += 1;
  if (state.sending.at < state.sending.order.length) return showSend();
  const helpers = state.sending.contacts.filter((c) => c.role === "family").map((c) => first(c.name));
  $("#done-names").textContent = `${helpers.join(" and ")}`;
  setupStep("done");
});
$("#setup-finish").addEventListener("click", () => loadHome());

// ---------------------------------------------------------------- new computer: get recordings back

async function startRestore() {
  show("restore");
  $("#restore-error").hidden = true;
  const st = await S.recovery.status().catch(() => null);
  if (st && st.status === "pending") return watchRecovery(st);
  $("#restore-start").hidden = false;
  $("#restore-progress").hidden = true;
}

$("#restore-ask").addEventListener("click", async () => {
  const b = $("#restore-ask");
  b.disabled = true;
  try {
    await S.recovery.start();
    watchRecovery(await S.recovery.status());
  } catch (ex) {
    $("#restore-progress").hidden = false;
    $("#restore-error").textContent = ex.message;
    $("#restore-error").hidden = false;
  }
  b.disabled = false;
});

function renderRecovery(st) {
  const row = (cls, mark, who, sub) => `<li class="${cls}"><span class="mark">${mark}</span><span>${who}<span class="sub">${sub}</span></span></li>`;
  const rows = st.contacts.map((c) => {
    const who = c.role === "self" ? "You" : esc(c.name);
    if (c.blocked) return row("stopped", "!", who, "Said this wasn't you");
    return c.approved ? row("done", "✓", who, "Clicked the button") : row("", "…", who, c.role === "self" ? "Check your email and click the button" : "Waiting for them to click the button");
  });
  rows.push(st.sondage.released ? row("done", "✓", "Sondage", "Checked it's you") : row("", "…", "Sondage", "Will call you to check it's you"));
  $("#restore-list").innerHTML = rows.join("");
  const n = Math.min(st.pieces, 2);
  $("#restore-lede").textContent = n === 0 ? "We sent the emails. Waiting for 2 people to click the button." : "1 person has clicked. Waiting for 1 more.";
}

async function watchRecovery(st) {
  $("#restore-start").hidden = true;
  $("#restore-progress").hidden = false;
  clearTimeout(state.recoveryTimer);
  const tick = async () => {
    try {
      st = await S.recovery.status();
    } catch {
      $("#restore-note").textContent = "We can't reach Sondage right now. Trying again…";
      state.recoveryTimer = setTimeout(tick, 8000);
      return;
    }
    if (!st) return startRestore();
    if (st.done) {
      $("#restore-list").innerHTML = "";
      $("#restore-lede").textContent = "Your recordings are back on this computer!";
      $("#restore-note").textContent = "";
      state.keys = await S.keys.status();
      setTimeout(loadHome, 2000);
      return;
    }
    if (st.status && st.status !== "pending") {
      $("#restore-error").textContent = st.status === "blocked" ? "Someone said this request wasn't you, so we stopped it. Sondage will call you." : "This request was closed. You can send the emails again.";
      $("#restore-error").hidden = false;
      $("#restore-start").hidden = false;
      return;
    }
    renderRecovery(st);
    if (st.problem) {
      $("#restore-error").textContent = st.problem;
      $("#restore-error").hidden = false;
    }
    state.recoveryTimer = setTimeout(tick, 4000);
  };
  renderRecovery(st);
  state.recoveryTimer = setTimeout(tick, 1500);
}

// For a helper sitting with them: paste two safety links or codes.
$("#restore-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const pick = (v) => (v.includes("#") ? v.split("#").pop() : v).trim();
  try {
    const me = await S.api("GET", "/api/v1/me").catch(() => null);
    await S.keys.restore([pick(e.target.s1.value), pick(e.target.s2.value)], me?.fellow?.signing_public_key || null);
    await S.recovery.cancel();
    await boot();
  } catch (ex) {
    $("#manual-error").textContent = ex.message;
    $("#manual-error").hidden = false;
  }
});

// ---------------------------------------------------------------- home

async function loadHome() {
  show("home");
  try {
    state.me = await S.api("GET", "/api/v1/me");
  } catch (ex) {
    $("#home-card").innerHTML = `<p class="problem">We can't reach Sondage right now. Check that the internet is on.</p>`;
    return;
  }
  if (state.me.fellow?.signing_public_key && state.me.fellow.signing_public_key !== state.keys.signingPublicKey) {
    $("#home-card").innerHTML = `<p class="problem">Please call your Sondage helper before your interview. (This computer has a different lock from your account.)</p>`;
    return;
  }
  $("#home-greeting").textContent = `Hello, ${first(state.me.fellow?.name || state.me.user.name)}.`;
  const next = (state.me.interviews || []).find((iv) => iv.status !== "sealed");
  const done = (state.me.interviews || []).filter((iv) => iv.status === "sealed");
  if (next) {
    $("#home-card").innerHTML = `
      <div class="card">
        <p class="label">Your interview</p>
        <p class="when">${next.scheduled_at ? `${esc(longDate(next.scheduled_at))} at ${esc(longTime(next.scheduled_at))}` : "Soon"}</p>
        <p class="with">with ${esc(next.historian?.name || "your interviewer")}. ${next.media_type === "video" ? "You will see and hear each other." : "You will hear each other. No camera."}</p>
        <button class="primary" data-join="${next.id}">Start my interview</button>
      </div>
      <div class="card"><p class="big">See your life story: your photos, songs and memories, in order.</p><button data-go="story">Open my life story</button></div>`;
  } else if (done.length) {
    $("#home-card").innerHTML = `<div class="card"><p class="big">Your interview is saved.</p><button class="primary" data-go="vault">Listen to my recording</button></div>`;
  } else {
    $("#home-card").innerHTML = `<div class="card"><p class="big">Your interview is not set up yet. Sondage will call you to pick a day.</p></div>`;
  }
}
document.addEventListener("click", (e) => {
  const j = e.target.closest("[data-join]");
  if (j) startCheck(state.me.interviews.find((i) => String(i.id) === j.dataset.join));
});

// ---------------------------------------------------------------- before the interview

function checkStep(name) {
  show("check");
  $$("#view-check .step").forEach((s) => (s.hidden = s.dataset.check !== name));
  $("#check-count").textContent = name === "headphones" ? "Getting ready · Step 1 of 2" : "Getting ready · Step 2 of 2";
}

function startCheck(iv) {
  state.check = { iv, micId: state.check?.micId || null, camId: state.check?.camId || null };
  $("#mic-help").hidden = true;
  checkStep("headphones");
}
$("[data-check-next]").addEventListener("click", async () => {
  checkStep("mic");
  await openCheckStream();
});

async function openCheckStream() {
  stopCheckStream();
  const iv = state.check.iv;
  const video = iv.media_type === "video";
  $("#mic-question").textContent = video ? "Do you see the green bar move? Can you see yourself?" : "Do you see the green bar move?";
  $("#cam-label").hidden = !video;
  try {
    state.check.stream = await openRawMicrophone(state.check.micId, { video, videoDeviceId: state.check.camId });
  } catch (ex) {
    $("#processing-warning").innerHTML = `<p class="big">We can't use your microphone${video ? " or camera" : ""}.</p><p>Your computer may be asking for permission. Look for a message and click <strong>Allow</strong>. Then click <strong>No, it doesn't</strong> below to try again.</p>`;
    $("#processing-warning").hidden = false;
    return;
  }
  const stream = state.check.stream;
  const track = stream.getAudioTracks()[0];
  state.check.micId = track.getSettings().deviceId;
  if (video && stream.getVideoTracks()[0]) {
    state.check.camId = stream.getVideoTracks()[0].getSettings().deviceId;
    $("#cam-preview").srcObject = stream;
    $("#cam-preview").hidden = false;
  } else $("#cam-preview").hidden = true;

  // Recording must be untouched. Explain plainly if the computer is changing the voice.
  const problems = processingProblems(describeAudioTrack(track));
  const os = state.config.platform;
  $("#processing-warning").hidden = problems.length === 0;
  $("#processing-warning").innerHTML = problems.length
    ? `<p class="big">Your computer is changing the sound of your voice. We need your real voice.</p><p>Please call your Sondage helper to fix this. ${os === "darwin" ? "(On a Mac: Control Centre → Mic Mode → Standard.)" : os === "win32" ? "(On Windows: Sound settings → microphone → turn off Audio enhancements.)" : ""}</p>`
    : "";
  $("#mic-yes").disabled = problems.length > 0;

  const devices = await navigator.mediaDevices.enumerateDevices();
  const opts = (kind, current) => devices.filter((d) => d.kind === kind).map((d) => `<option value="${esc(d.deviceId)}" ${d.deviceId === current ? "selected" : ""}>${esc(d.label || "Device")}</option>`).join("");
  $("#mic-select").innerHTML = opts("audioinput", state.check.micId);
  $("#cam-select").innerHTML = opts("videoinput", state.check.camId);

  const ctx = new AudioContext();
  const an = ctx.createAnalyser();
  an.fftSize = 1024;
  ctx.createMediaStreamSource(new MediaStream([track])).connect(an);
  const buf = new Float32Array(an.fftSize);
  const tick = () => {
    if (state.check.ctx !== ctx) return;
    an.getFloatTimeDomainData(buf);
    let peak = 0;
    for (const v of buf) peak = Math.max(peak, Math.abs(v));
    $("#meter-fill").style.width = `${Math.min(100, Math.sqrt(peak) * 110)}%`;
    requestAnimationFrame(tick);
  };
  state.check.ctx = ctx;
  tick();
}
function stopCheckStream() {
  if (state.check?.ctx) state.check.ctx.close();
  if (state.check) state.check.ctx = null;
  state.check?.stream?.getTracks().forEach((t) => t.stop());
  if (state.check) state.check.stream = null;
}
$("#mic-no").addEventListener("click", () => {
  $("#mic-help").hidden = false;
  openCheckStream();
});
$("#mic-select").addEventListener("change", (e) => { state.check.micId = e.target.value; openCheckStream(); });
$("#cam-select").addEventListener("change", (e) => { state.check.camId = e.target.value; openCheckStream(); });
$("#mic-yes").addEventListener("click", () => {
  stopCheckStream();
  joinRoom(state.check.iv);
});

// ---------------------------------------------------------------- the interview

const fmtClock = (s) => {
  s = Math.floor(s);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${m}:${String(sec).padStart(2, "0")}`;
};
const trackLabel = (id) => (id.startsWith("fellow-audio") ? "Your voice" : id.startsWith("fellow-video") ? "Your camera" : id.startsWith("historian-audio") ? "Interviewer's voice" : id.startsWith("historian-video") ? "Interviewer's camera" : id);
const segmentOf = (id) => Number((id.match(/-(\d+)$/) || [0, 1])[1]);

function setStatus(text) {
  $("#room-status").textContent = text;
}

// A circle that grows when someone speaks (shown in voice-only interviews).
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
      let peak = 0;
      for (const v of buf) peak = Math.max(peak, Math.abs(v));
      ringEl.style.transform = `scale(${1 + Math.min(0.35, Math.sqrt(peak) * 0.6)})`;
      requestAnimationFrame(tick);
    };
    tick();
    return ctx;
  } catch {
    return null;
  }
}

async function joinRoom(iv) {
  // The interviewer may have opened their page after this screen loaded: ask again.
  try {
    state.me = await S.api("GET", "/api/v1/me");
    iv = state.me.interviews.find((i) => i.id === iv.id) || iv;
  } catch {}
  if (!iv.historian?.signing_public_key) {
    show("home");
    $("#home-card").insertAdjacentHTML("afterbegin", `<p class="problem">Your interviewer isn't ready yet. Please wait a minute and try again, or call your Sondage helper.</p>`);
    return;
  }
  show("room");
  const video = iv.media_type === "video";
  const room = (state.room = {
    iv, video, recording: false, segments: 0, historianTracks: new Map(), sessionId: String(iv.id),
    sender: new ChunkSender(), channel: null, waiters: {}, rings: [],
  });
  $("#stage").classList.toggle("audio-only", !video);
  $("#remote-name").textContent = iv.historian.name;
  $("#remote-initials").textContent = initials(iv.historian.name);
  $("#local-initials").textContent = initials(state.me.user.name);
  $("#rec-banner").className = "rec-banner";
  $("#rec-banner").textContent = "Not recording yet";
  $("#timer").hidden = true;
  $("#saved-line").hidden = true;
  $("#end-rec").hidden = true;
  $("#start-rec").hidden = true;
  setStatus(`Waiting for ${iv.historian.name}…`);

  room.stream = await openRawMicrophone(state.check?.micId, { video, videoDeviceId: state.check?.camId });
  $("#local-video").srcObject = room.stream;
  room.rings.push(voiceRing(room.stream, $("#local-ring")));
  // An earlier try at this interview may already be saved here. Never write over it:
  // each new start becomes a new part (segment) of the same interview.
  const earlier = await S.rec.open(room.sessionId, { title: iv.title });
  room.segments = Math.max(0, ...earlier.filter((t) => t.id.startsWith("historian-") && t.chunks > 0).map((t) => segmentOf(t.id)));
  room.fellowSegments = Math.max(0, ...earlier.filter((t) => t.id.startsWith("fellow-") && t.chunks > 0).map((t) => segmentOf(t.id)));

  room.receiver = new ChunkReceiver({
    onChunk: async (c) => {
      await S.rec.chunk({ sessionId: room.sessionId, trackId: c.track, index: c.index, bytes: c.bytes, expectedSha256: c.sha256, sampleStart: c.meta?.sampleStart, sampleCount: c.meta?.sampleCount });
    },
    onControl: (msg) => onHistorianControl(msg),
  });

  const consumer = (room.consumer = createConsumer(await S.cableUrl()));
  room.sub = consumer.subscriptions.create({ channel: "InterviewChannel", interview_id: iv.id }, {
    connected: () => room.call.start(),
    received: (msg) => room.call.handleSignal(msg),
  });
  room.call = new InterviewCall({
    role: "fellow",
    iceServers: iv.ice_servers,
    localStream: room.stream,
    signal: (msg) => room.sub.perform("signal", { payload: msg }),
    onRemoteStream: (s) => {
      $("#remote-video").srcObject = s; // plays their voice too
      room.rings.push(voiceRing(s, $("#remote-ring")));
    },
    onChannel: (dc) => {
      room.channel = dc;
      wire(dc, { sender: room.sender, receiver: room.receiver });
      setStatus(room.recording ? `You are talking with ${room.iv.historian.name}.` : `You are talking with ${room.iv.historian.name}. They will start the recording.`);
      sendControl(dc, { t: "fellow-state", recording: room.recording });
      if (room.recording) sendControl(dc, { t: "recording", on: true, nextSegment: room.segments + 1 });
    },
    onState: (s) => {
      if (s === "connected") setStatus(room.recording ? `You are talking with ${room.iv.historian.name}.` : `You are talking with ${room.iv.historian.name}. They will start the recording.`);
      else if (["disconnected", "failed", "channel-closed"].includes(s)) setStatus("The connection dropped. Reconnecting… Your recording is still safe.");
      else if (s === "left") setStatus(`${room.iv.historian.name} left the call.`);
    },
  });
}

async function onHistorianControl(msg) {
  const room = state.room;
  if (!room) return;
  if (msg.t === "track") {
    await S.rec.track(room.sessionId, { id: msg.id, kind: msg.kind, role: "historian", info: msg.info || {} });
    room.historianTracks.set(msg.id, { ended: false });
    const seg = Number((msg.id.match(/-(\d+)$/) || [0, 1])[1]);
    room.segments = Math.max(room.segments, seg);
    await S.rec.log(room.sessionId, "historian", "recording-started", msg.id);
  } else if (msg.t === "track-end") {
    await S.rec.endTrack(room.sessionId, msg.id, msg.summary || {});
    room.historianTracks.set(msg.id, { ended: true, finalChain: msg.finalChain, chunks: msg.chunks });
    room.waiters.trackEnd?.();
  } else if (msg.t === "signature") {
    room.waiters.signature?.resolve(msg);
  } else if (msg.t === "refuse") {
    room.waiters.signature?.reject(new Error(`${room.iv.historian.name}'s browser declined to sign: ${msg.reason}`));
  } else if (msg.t === "historian-state") {
    // Back after a dropped call while the interviewer is still recording: pick it up again.
    if (msg.recording && !room.recording) await startRecording("historian");
  } else if (msg.t === "request-start") {
    // The interviewer starts the recording; the Fellow just talks.
    if (!room.recording) await startRecording("historian");
  } else if (msg.t === "request-end") {
    if (room.recording) endAndSeal();
  }
}

async function startRecording(by) {
  const room = state.room;
  if (!room?.channel || room.recording) return;
  room.recording = true;
  room.fellowSegments += 1;
  const suffix = room.fellowSegments > 1 ? `-${room.fellowSegments}` : "";
  room.audioId = `fellow-audio${suffix}`;
  room.videoId = `fellow-video${suffix}`;
  const track = room.stream.getAudioTracks()[0];
  room.audioRec = new RawAudioRecorder(room.stream, {
    onChunk: async (c) => {
      await S.rec.chunk({ sessionId: room.sessionId, trackId: room.audioId, index: c.index, bytes: c.bytes, sampleStart: c.sampleStart, sampleCount: c.sampleCount });
      $("#saved-line").hidden = false;
    },
  });
  await room.audioRec.start();
  const d = describeAudioTrack(track);
  await S.rec.track(room.sessionId, {
    id: room.audioId, kind: "audio", role: "fellow",
    info: { sampleRate: room.audioRec.sampleRate, device: { label: d.label }, processing: { echoCancellation: d.echoCancellation, noiseSuppression: d.noiseSuppression, autoGainControl: d.autoGainControl, voiceIsolation: d.voiceIsolation, deviceSampleRate: d.sampleRate, captureSampleRate: room.audioRec.sampleRate } },
  });
  if (room.video) {
    room.videoRec = new LocalVideoRecorder(room.stream, {
      onChunk: async (c) => {
        await S.rec.chunk({ sessionId: room.sessionId, trackId: room.videoId, index: c.index, bytes: c.bytes });
      },
    });
    await S.rec.track(room.sessionId, { id: room.videoId, kind: "video", role: "fellow", info: { mimeType: room.videoRec.mimeType } });
    room.videoRec.start();
  }
  await S.rec.log(room.sessionId, by, "recording-started");
  sendControl(room.channel, { t: "recording", on: true, nextSegment: room.segments + 1 });
  sendControl(room.channel, { t: "fellow-state", recording: true });
  room.startedAt = new Date().toISOString();
  const t0 = Date.now();
  $("#timer").hidden = false;
  room.timer = setInterval(() => ($("#timer").textContent = fmtClock((Date.now() - t0) / 1000)), 500);
  $("#rec-banner").className = "rec-banner on";
  $("#rec-banner").textContent = "Recording";
  setStatus(`You are talking with ${room.iv.historian.name}.`);
  $("#end-rec").hidden = false;
  window.onbeforeunload = () => "Your interview is still recording.";
}
$("#start-rec").addEventListener("click", () => startRecording("fellow"));

$("#leave-room").addEventListener("click", async () => {
  const room = state.room;
  if (room?.recording) {
    if (!confirm("Your interview is being recorded. Leave anyway?\n\nWhat you said so far stays saved on this computer.")) return;
    await stopOwnRecorders();
  }
  teardownRoom();
  loadHome();
});

async function stopOwnRecorders() {
  const room = state.room;
  clearInterval(room.timer);
  if (room.audioRec) await S.rec.endTrack(room.sessionId, room.audioId, await room.audioRec.stop());
  if (room.videoRec) await S.rec.endTrack(room.sessionId, room.videoId, await room.videoRec.stop());
  room.recording = false;
  room.audioRec = room.videoRec = null;
  window.onbeforeunload = null;
}

function teardownRoom() {
  const room = state.room;
  if (!room) return;
  try { room.call?.close(); } catch {}
  try { room.sub?.unsubscribe(); room.consumer?.disconnect(); } catch {}
  room.rings.forEach((c) => c?.close?.());
  room.stream?.getTracks().forEach((t) => t.stop());
  state.room = null;
}

// ---------------------------------------------------------------- saving (sealing)

const STEPS = [
  ["stop", "Stop recording on both sides"],
  ["collect", "Receive every last piece of the interviewer's recording"],
  ["manifest", "List every file and its fingerprint"],
  ["historian", "The interviewer signs"],
  ["seal", "You sign, the time is certified, and it's locked so only you can open it"],
  ["receipt", "Send Sondage a receipt (never the recording)"],
];
function step(id, status, detail) {
  const li = $(`#seal-steps li[data-step="${id}"]`);
  li.className = status;
  if (detail !== undefined) $(".detail", li).textContent = detail;
}

$("#seal-retry").addEventListener("click", () => {
  if (state.room) return endAndSeal();
  loadHome();
});
$("#seal-gohome").addEventListener("click", () => {
  teardownRoom();
  loadHome();
});

$("#end-rec").addEventListener("click", () => {
  if (!confirm("Stop the recording and save it?")) return;
  endAndSeal();
});

async function endAndSeal() {
  const room = state.room;
  if (!room || room.sealing) return;
  room.sealing = true;
  show("seal");
  $("#seal-title").textContent = "Saving your recording…";
  $("#seal-lede").textContent = "Please keep this window open. This takes about a minute.";
  $("#seal-spinner").hidden = false;
  $("#seal-steps").innerHTML = STEPS.map(([id, label]) => `<li data-step="${id}">${label}<span class="detail"></span></li>`).join("");
  $("#seal-error").hidden = true;
  $("#seal-result").innerHTML = "";
  $("#seal-home").hidden = true;
  $("#seal-stuck").hidden = true;
  try {
    step("stop", "active");
    await stopOwnRecorders();
    const waitingFor = () => [...room.historianTracks.values()].filter((t) => !t.ended).length;
    const allEnded = new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`${room.iv.historian.name}'s part of the recording didn't finish arriving.`)), 180000);
      room.waiters.trackEnd = () => { if (waitingFor() === 0) { clearTimeout(t); resolve(); } };
      if (!sendControl(room.channel, { t: "end" })) { clearTimeout(t); reject(new Error("The call is not connected.")); }
      if (room.historianTracks.size > 0 && waitingFor() === 0) { clearTimeout(t); resolve(); }
    });
    step("stop", "done");
    step("collect", "active");
    await allEnded;
    const status = await S.rec.status(room.sessionId);
    for (const [id, claim] of room.historianTracks) {
      const got = status.find((s) => s.id === id);
      if (!got || got.chunks !== claim.chunks || got.link !== claim.finalChain) throw new Error(`${trackLabel(id)} arrived incomplete (${got?.chunks ?? 0} of ${claim.chunks} pieces).`);
    }
    step("collect", "done", `${room.historianTracks.size} part${room.historianTracks.size === 1 ? "" : "s"} complete`);

    step("manifest", "active");
    const built = await S.rec.manifest(room.sessionId, {
      session: { id: room.sessionId, title: room.iv.title, mediaType: room.iv.media_type, scheduledAt: room.iv.scheduled_at, startedAt: room.startedAt, endedAt: new Date().toISOString() },
      fellow: { name: state.me.user.name },
      historian: { name: room.iv.historian.name, signingPublicKey: room.iv.historian.signing_public_key },
    });
    step("manifest", "done", `Fingerprint ${built.manifestSha256.slice(0, 16).match(/.{4}/g).join(" ")}`);

    step("historian", "active");
    const bytes = new TextEncoder().encode(built.manifestText);
    const sig = new Promise((resolve, reject) => {
      room.waiters.signature = { resolve, reject };
      setTimeout(() => reject(new Error("The interviewer didn't sign in time.")), 180000);
    });
    await room.sender.send({ track: "manifest", index: 0, bytes: bytes.buffer, sha256: await sha256Hex(bytes), meta: { capsuleId: built.capsuleId } });
    const signed = await sig;
    step("historian", "done", `Signed by ${room.iv.historian.name}`);

    step("seal", "active");
    const result = await S.rec.seal(room.sessionId, signed.signature, room.iv.historian.signing_public_key);
    const ts = result.receipt.timestamp;
    step("seal", "done", ts.status === "granted" ? `Time certified: ${new Date(ts.genTime).toLocaleString()}` : ts.status === "not-requested" ? "Time certification is turned off." : "The time certification service wasn't reachable.");

    step("receipt", "active");
    try {
      await S.api("POST", `/api/v1/interviews/${room.iv.id}/capsule`, { receipt: result.receipt });
      step("receipt", "done");
    } catch (ex) {
      step("receipt", "failed", `Not sent: ${ex.message}. The recording is safe.`);
    }
    sendControl(room.channel, { t: "sealed", capsuleId: result.receipt.capsuleId, manifestSha256: result.receipt.manifestSha256 });
    setTimeout(teardownRoom, 1500);

    $("#seal-title").textContent = "Your recording is saved.";
    $("#seal-lede").textContent = "It is locked so only you can open it. You can listen to it any time.";
    $("#seal-spinner").hidden = true;
    $("#seal-home").hidden = false;
  } catch (ex) {
    room.sealing = false;
    const active = $("#seal-steps li.active");
    if (active) active.className = "failed";
    $("#seal-title").textContent = "We need a little help";
    $("#seal-lede").textContent = "Don't worry. Everything you said is still saved on this computer. Please call your Sondage helper.";
    $("#seal-spinner").hidden = true;
    $("#seal-error").textContent = ex.message;
    $("#seal-error").hidden = false;
    $("#seal-stuck").hidden = false;
    console.error(ex);
  }
}

// ---------------------------------------------------------------- my life story

async function loadStory() {
  show("story");
  const box = $("#story-timeline");
  box.innerHTML = "";
  $("#story-message").hidden = true;
  try {
    const data = await S.api("GET", "/api/v1/fellow/timeline");
    // Photos and scans are loaded from the Sondage website.
    mountTimeline(box, data, { editable: false, assetBase: state.config.serverUrl });
  } catch {
    $("#story-message").textContent = "We can't show your life story right now. Check that the internet is on.";
    $("#story-message").hidden = false;
  }
}

// ---------------------------------------------------------------- my recordings

async function loadVault() {
  show("vault");
  state.config = await S.config.get();
  $("#vault-path").textContent = state.config.vaultDir;
  const list = await S.vault.list();
  state.capsules = list;
  $("#capsules").innerHTML = list.length
    ? list.map((r, i) => `
      <article class="card capsule-card">
        <div>
          <h3>${esc(r.session?.title || "My interview")}</h3>
          <p class="big">Recorded ${esc(longDate(r.sealedAt))}</p>
        </div>
        <div class="actions">
          <button class="primary" data-listen="${i}" ${r.present ? "" : "disabled"}>Listen</button>
          <button data-verify="${i}" ${r.present ? "" : "disabled"}>Check it is safe</button>
        </div>
        <p class="check-result" hidden></p>
      </article>`).join("")
    : `<p class="empty">Nothing here yet. Your interview will appear here after it is saved.</p>`;
}
$("#vault-change").addEventListener("click", async () => { if (await S.config.chooseVault()) loadVault(); });
document.addEventListener("click", async (e) => {
  const v = e.target.closest("[data-verify]");
  if (v) {
    const r = state.capsules[+v.dataset.verify];
    const out = $(".check-result", v.closest(".capsule-card"));
    out.hidden = false;
    out.className = "check-result";
    out.textContent = "Checking…";
    v.disabled = true;
    try {
      const res = await S.vault.verify(r.capsulePath, r.receiptPath);
      out.className = `check-result ${res.ok ? "good" : "bad"}`;
      out.textContent = res.ok ? "✓ Yes. It is safe and has not been changed." : "There is a problem with this recording. Please call your Sondage helper.";
      out.title = res.checks.filter((c) => !c.ok).map((c) => c.name).join("; ");
    } catch (ex) {
      out.className = "check-result bad";
      out.textContent = "We couldn't check it. Please call your Sondage helper.";
    }
    v.disabled = false;
  }
  const l = e.target.closest("[data-listen]");
  if (l) openListen(state.capsules[+l.dataset.listen]);
});

// ---------------------------------------------------------------- listening

async function openListen(r) {
  show("listen");
  $("#listen-title").textContent = r.session?.title || "My interview";
  $("#listen-date").textContent = "Opening…";
  $("#listen-media").innerHTML = "";
  const { tracks } = await S.vault.listen(r.capsulePath);
  $("#listen-date").textContent = `Recorded ${longDate(r.sealedAt)}`;
  // Every part plays at the moment it was recorded, so everyone is heard in step.
  const els = tracks.map((t) => {
    const m = document.createElement(t.kind === "video" ? "video" : "audio");
    m.src = t.url;
    m.preload = "auto";
    m.dataset.offset = t.offset || 0;
    if (t.kind === "video") { m.muted = true; m.playsInline = true; m.style.width = "48%"; m.style.marginRight = "2%"; }
    $("#listen-media").appendChild(m);
    return m;
  });
  await Promise.all(els.map((m) => new Promise((r) => (m.readyState >= 1 ? r() : (m.onloadedmetadata = r, m.onerror = r)))));
  const audio = els.filter((m) => m.tagName === "AUDIO");
  const len = (m) => (Number.isFinite(m.duration) ? m.duration : 0);
  const total = Math.max(1, ...audio.map((m) => +m.dataset.offset + len(m)));
  // One clock for the whole interview; each part follows it.
  const clock = { at: 0, playing: false, since: 0 };
  const now = () => (clock.playing ? clock.at + (performance.now() - clock.since) / 1000 : clock.at);
  const sync = (force) => {
    const t = now();
    for (const m of els) {
      const local = t - +m.dataset.offset;
      const inside = local >= 0 && (len(m) === 0 || local < len(m));
      if (clock.playing && inside) {
        if (force || m.paused || Math.abs(m.currentTime - local) > 0.35) m.currentTime = local;
        if (m.paused) m.play().catch(() => {});
      } else {
        if (!m.paused) m.pause();
        if (force && inside) m.currentTime = local;
      }
    }
    $("#play-time").textContent = fmtClock(Math.min(t, total));
    $("#seek").value = Math.round((Math.min(t, total) / total) * 1000);
    if (t >= total && clock.playing) { clock.at = total; clock.playing = false; $("#play").textContent = "▶"; }
  };
  const btn = $("#play");
  btn.textContent = "▶";
  btn.onclick = () => {
    if (clock.playing) { clock.at = now(); clock.playing = false; btn.textContent = "▶"; btn.ariaLabel = "Play"; }
    else { if (clock.at >= total) clock.at = 0; clock.since = performance.now(); clock.playing = true; btn.textContent = "❚❚"; btn.ariaLabel = "Pause"; }
    sync(true);
  };
  $("#seek").oninput = (e) => {
    clock.at = (e.target.value / 1000) * total;
    clock.since = performance.now();
    sync(true);
  };
  state.listen = { els, timer: setInterval(() => sync(false), 250) };
  sync(true);
}
function stopListening() {
  clearInterval(state.listen?.timer);
  state.listen?.els.forEach((m) => { m.pause(); m.removeAttribute("src"); m.load(); });
  state.listen = null;
}

// ---------------------------------------------------------------- help

async function loadSettings() {
  show("settings");
  state.config = await S.config.get();
  const k = await S.keys.status();
  const contacts = await S.keys.contacts().catch(() => []);
  $("#helpers-list").innerHTML = contacts.filter((c) => c.role === "family").map((c) => `<li><span class="mark">✓</span><span>${esc(c.name)}<span class="sub">${esc(c.email)}</span></span></li>`).join("")
    + `<li><span class="mark">✓</span><span>Sondage<span class="sub">Only after calling you to check</span></span></li>`;
  $("#settings-facts").innerHTML = `
    <dt>Signed in as</dt><dd>${esc(state.config.user?.name)} (${esc(state.config.user?.email)})</dd>
    <dt>Sondage server</dt><dd class="mono">${esc(state.config.serverUrl)}</dd>
    <dt>Key fingerprint</dt><dd class="mono">${esc(k.fingerprint)}</dd>
    <dt>Key storage</dt><dd>${state.config.keychain ? "This computer's keychain" : "A file only this user can read (no keychain on this system)"}</dd>
    <dt>Recordings folder</dt><dd class="mono">${esc(state.config.vaultDir)}</dd>
    <dt>Time certification</dt><dd class="mono">${esc(state.config.tsaUrl || "off")}</dd>
    <dt>App version</dt><dd>${esc(state.config.version)}</dd>`;
}
$("#resend-safety").addEventListener("click", () => startSending([1, 2, 0]));
$("#sign-out").addEventListener("click", async () => {
  if (!confirm("Sign out of Sondage on this computer?")) return;
  await S.auth.signOut();
  boot();
});

boot().catch((e) => {
  document.body.insertAdjacentHTML("beforeend", `<p class="problem">${esc(e.message)}</p>`);
  console.error(e);
});
