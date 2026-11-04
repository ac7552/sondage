// Stand-in for the Rails app, for end-to-end testing in this sandbox only.
// Mirrors the Rails API used by the desktop app, the Action Cable protocol used
// for signaling, and serves the real historian page scripts and timeline scripts.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { WebSocketServer } from "ws";
import { spawn } from "node:child_process";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const PORT = +process.env.PORT || 3999;
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

const users = {
  fellow: { id: 3, name: "Eleanor Ruiz", email: "eleanor@sondage.test", role: "fellow", password: "sondage-demo-2026", signing_public_key: null },
  historian: { id: 2, name: "Dr. Samuel Reyes", email: "historian@sondage.test", role: "historian", signing_public_key: null },
};
const fellow = { id: 1, age_recipient: null };
const meeting = { id: 1, title: "Life history interview with Eleanor Ruiz", media_type: process.env.MEDIA || "video", status: "scheduled", scheduled_at: new Date(Date.now() + 3600e3).toISOString() };
const tokens = new Map(); // token -> "fellow" | "heir"
users.heir = { id: 9, name: "Ana Ruiz", email: "ana@example.com", role: "heir", password: "heir-demo-2026" };
const claim = { id: 1, status: null, contactSha: null, release_after: null }; // after a Fellow's death
// Sondage's copy is unlocking half || signing half (66 hex each); see web/app/models/safety_share.rb.
const unlockingHalf = (hex) => (/^[0-9a-f]{132}$/i.test(hex || "") ? hex.slice(0, 66) : hex);
const safety = { sondageShare: null, contacts: [], recoveries: [] };
const sha = (hex) => crypto.createHash("sha256").update(Buffer.from(hex, "hex")).digest("hex");
export const state = { receipt: null };

// RELAY=1: run a local TURN relay and make both sides use only the relay, the way
// two homes that can't reach each other directly would. Credentials are made the
// same way the Rails app makes them (coturn's shared-secret scheme).
const RELAY = !!process.env.RELAY;
const iceFor = (userId) => {
  if (!RELAY) return { ice_servers: [], relay_only: false };
  const username = `${Math.floor(Date.now() / 1000) + 12 * 3600}:${userId}`;
  const credential = crypto.createHmac("sha1", "test-secret").update(username).digest("base64");
  return { ice_servers: [{ urls: ["turn:127.0.0.1:3478?transport=udp"], username, credential }], relay_only: true };
};
if (RELAY) {
  // The real coturn relay, set up the way deploy/coturn/turnserver.conf sets it up.
  const turn = spawn("turnserver", ["-n", "--listening-ip=127.0.0.1", "--relay-ip=127.0.0.1", "--listening-port=3478", "--use-auth-secret", "--static-auth-secret=test-secret",
    "--realm=sondage.test", "--no-tls", "--no-dtls", "--allow-loopback-peers", "--no-cli", "--fingerprint", "--no-multicast-peers", "--log-file=stdout"], { stdio: ["ignore", "pipe", "pipe"] });
  turn.stdout.on("data", (d) => /allocation|error/i.test(d) && fs.appendFileSync(new URL("./out/turn.log", import.meta.url), d));
  process.on("exit", () => turn.kill());
  for (const sig of ["SIGTERM", "SIGINT"]) process.on(sig, () => process.exit(0));
  log("TURN relay (coturn) on 127.0.0.1:3478, relay only");
}

const sample = JSON.parse(fs.readFileSync(new URL("./sample-timeline.json", import.meta.url)));

// Journal and matching, as the Rails API returns them.
const jr = {
  nextId: 1, entries: [], voices: new Map(),
  prompts: [{ id: 1, text: "What did your mother cook on Sundays in Ponce?", from: "Dr. Samuel Reyes", dismissed: false }, { id: 2, text: "Do you remember the first time you saw snow?", from: "Dr. Samuel Reyes", dismissed: false }],
};
const answered = () => new Set(jr.entries.map((e) => e.prompt?.id).filter(Boolean));
const waitingPrompts = () => jr.prompts.filter((p) => !p.dismissed && !answered().has(p.id)).map(({ id, text, from }) => ({ id, text, from }));
function saveEntry(e, b) {
  const x = b.entry || {};
  if (x.body !== undefined && e.id && e.body && x.body !== e.body) {
    e.versions = e.versions || [];
    e.versions.unshift({ id: Date.now(), body: e.body, written_until: new Date().toISOString() });
  }
  if (x.body !== undefined) e.body = x.body;
  e.versions_count = (e.versions || []).length;
  if (x.shared_with_historian !== undefined) e.shared_with_historian = !!x.shared_with_historian;
  if (x.era_id !== undefined) { const era = sample.eras.find((r) => String(r.id) === String(x.era_id)); e.era = era ? { id: era.id, title: era.title } : null; }
  if (x.journal_prompt_id) { const pr = jr.prompts.find((r) => r.id === +x.journal_prompt_id); e.prompt = pr ? { id: pr.id, text: pr.text } : null; }
  if (b.remove_voice) { jr.voices.delete(e.id); e.voice = null; }
  if (x.voice?.base64) {
    const bytes = Buffer.from(x.voice.base64, "base64");
    const type = String(x.voice.content_type).split(";")[0];
    jr.voices.set(e.id, { bytes, type });
    e.voice = { content_type: type, bytes: bytes.length };
  }
  if (!e.body && !e.voice) return "Write something or record your voice";
  e.updated_at = new Date().toISOString();
  return null;
}
const hist = {
  matched: null, seeking: false, intro: "", languages: "",
  list: [
    { id: 2, name: "Dr. Samuel Reyes", headline: "Oral historian of Puerto Rican New York", bio: "I grew up in East Harlem listening to my grandmother's stories. I speak English and Spanish, and I like to go slowly.", languages: ["English", "Spanish"], regions: ["New York", "Puerto Rico"], specialties: ["Migration", "family businesses", "music"], chosen: false, wants_you: true },
    { id: 4, name: "Grace Whitfield", headline: "Life stories of working people in the American South", bio: "I spent my career at a small-town library in Georgia. I am a patient listener and I never rush.", languages: ["English"], regions: ["Georgia", "the Carolinas"], specialties: ["Farming", "nursing"], chosen: false, wants_you: false },
    { id: 5, name: "Dr. Daniel Okonkwo", headline: "Historian of postwar immigration and city life", bio: "I record the lives of people who built new homes in American cities after the war.", languages: ["English", "French"], regions: ["New York", "Chicago"], specialties: ["Immigration", "faith"], chosen: false, wants_you: false },
  ],
};

function json(res, code, obj) {
  res.writeHead(code, { "Content-Type": "application/json" });
  res.end(JSON.stringify(obj));
}
function body(req) {
  return new Promise((r) => { let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => r(b ? JSON.parse(b) : {})); });
}
const types = { ".js": "text/javascript", ".css": "text/css", ".jpg": "image/jpeg", ".html": "text/html" };
function file(res, p) {
  if (!fs.existsSync(p)) return json(res, 404, { error: "nf" });
  res.writeHead(200, { "Content-Type": types[path.extname(p)] || "application/octet-stream" });
  fs.createReadStream(p).pipe(res);
}
const authed = (req) => tokens.has((req.headers.authorization || "").replace("Bearer ", ""));

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const p = url.pathname;
  if (p === "/api/v1/session" && req.method === "POST") {
    const b = await body(req);
    const u = [users.fellow, users.heir].find((x) => x.email === b.email && x.password === b.password);
    if (!u) return json(res, 401, { error: "That email and password don't match." });
    const t = crypto.randomBytes(20).toString("hex");
    tokens.set(t, u.role);
    log(`desktop signed in (${u.role})`);
    return json(res, 201, { token: t, user: { id: u.id, name: u.name, email: u.email, role: u.role } });
  }
  if (p.startsWith("/api/") && !authed(req)) return json(res, 401, { error: "Please sign in again." });
  if (p === "/api/v1/session" && req.method === "DELETE") return json(res, 204, {});
  if (p === "/api/v1/me") {
    return json(res, 200, {
      user: { id: 3, name: users.fellow.name, email: users.fellow.email, role: "fellow" },
      fellow: { id: 1, name: users.fellow.name, stage: "interview", signing_public_key: users.fellow.signing_public_key, age_recipient: fellow.age_recipient,
        safety_contacts: safety.contacts.map(({ id, name, email, role, heir }) => ({ id, name, email, role, heir: !!heir })), pending_recovery_id: safety.recoveries.find((r) => r.status === "pending")?.id || null,
        historian: hist.matched?.name || null, journal_prompts_waiting: waitingPrompts().length, next_journal_prompt: waitingPrompts()[0] || null, journal_entries_count: jr.entries.length },
      interviews: [{ ...meeting, part: 1, parts: 1, historian: { name: users.historian.name, signing_public_key: users.historian.signing_public_key }, capsule: null, ...iceFor(3) }],
    });
  }
  if (p === "/api/v1/keys" && req.method === "PUT") {
    const b = await body(req);
    users.fellow.signing_public_key = b.signing_public_key;
    fellow.age_recipient = b.age_recipient;
    if (b.sondage_share) { safety.sondageShare = b.sondage_share; safety.contacts = b.safety_contacts.map((c, i) => ({ ...c, id: i + 1, heir: false })); }
    log("safety copies registered:", safety.contacts.map((c) => `${c.name} (${c.role})`).join(", "));
    log("fellow key registered", b.signing_public_key.slice(0, 12));
    return json(res, 200, { ok: true });
  }
  if (p === "/api/v1/fellow/timeline") return json(res, 200, sample);
  if (p === "/api/v1/journal" && req.method === "GET") {
    return json(res, 200, { entries: [...jr.entries].reverse().map(({ versions, ...e }) => e), prompts: waitingPrompts(), eras: sample.eras.map(({ id, title, start_year, end_year, startYear, endYear }) => ({ id, title, start_year: start_year ?? startYear, end_year: end_year ?? endYear })), historian: hist.matched?.name || "Dr. Samuel Reyes" });
  }
  if (p === "/api/v1/journal" && req.method === "POST") {
    const e = { id: jr.nextId++, written_on: new Date().toISOString().slice(0, 10), body: "", shared_with_historian: false, era: null, prompt: null, voice: null };
    const err = saveEntry(e, await body(req));
    if (err) return json(res, 422, { error: err });
    jr.entries.push(e);
    log(`journal: new entry ${e.id}${e.voice ? ` with voice (${e.voice.bytes} bytes, ${e.voice.content_type})` : ""}${e.shared_with_historian ? ", shared" : ", private"}`);
    return json(res, 201, e);
  }
  let jm, jm2;
  if ((jm = p.match(/^\/api\/v1\/journal\/prompts\/(\d+)\/dismiss$/))) { const pr = jr.prompts.find((r) => r.id === +jm[1]); if (pr) pr.dismissed = true; return json(res, 204, {}); }
  if ((jm = p.match(/^\/api\/v1\/journal\/(\d+)\/versions$/))) {
    const e = jr.entries.find((r) => r.id === +jm[1]);
    return e ? json(res, 200, { versions: e.versions || [] }) : json(res, 404, { error: "Not found" });
  }
  if ((jm = p.match(/^\/api\/v1\/journal\/(\d+)\/voice$/))) {
    const v = jr.voices.get(+jm[1]);
    if (!v) return json(res, 404, { error: "Not found" });
    res.writeHead(200, { "Content-Type": v.type });
    return res.end(v.bytes);
  }
  if ((jm = p.match(/^\/api\/v1\/journal\/(\d+)$/))) {
    const e = jr.entries.find((r) => r.id === +jm[1]);
    if (!e) return json(res, 404, { error: "Not found" });
    if (req.method === "DELETE") { jr.entries = jr.entries.filter((r) => r !== e); jr.voices.delete(e.id); log(`journal: deleted ${e.id}`); return json(res, 204, {}); }
    const err = saveEntry(e, await body(req));
    if (err) return json(res, 422, { error: err });
    log(`journal: changed ${e.id}: ${JSON.stringify(e.body)} (${e.versions_count} earlier version${e.versions_count === 1 ? "" : "s"} kept)`);
    const { versions, ...out } = e;
    return json(res, 200, out);
  }
  if (p === "/api/v1/historians") return json(res, 200, { matched: hist.matched, seeking: hist.seeking, intro: hist.intro, languages: hist.languages, max_choices: 3, historians: hist.list });
  if ((jm = p.match(/^\/api\/v1\/historians\/(\d+)\/choose$/))) {
    const h = hist.list.find((r) => r.id === +jm[1]);
    if (!h) return json(res, 404, { error: "Not found" });
    if (req.method === "POST" && hist.list.filter((r) => r.chosen).length >= 3) return json(res, 422, { error: "You can choose up to 3 historians" });
    h.chosen = req.method === "POST";
    if (h.chosen) hist.seeking = true;
    log(`matching: fellow ${h.chosen ? "chose" : "withdrew"} ${h.name}${h.chosen && h.wants_you ? " (mutual: admins emailed)" : ""}`);
    return json(res, 200, { chosen: h.chosen, mutual: h.chosen && h.wants_you });
  }
  if (p === "/api/v1/match_intro") { const b = await body(req); hist.intro = b.fellow.match_intro; hist.languages = b.fellow.languages; log("matching: intro saved"); return json(res, 204, {}); }
  if (p === "/test/confirm-match") { const h = hist.list.find((r) => r.chosen && r.wants_you); hist.matched = { ...h }; delete hist.matched.chosen; delete hist.matched.wants_you; log(`matching: admin confirmed ${h.name}`); return json(res, 200, {}); }
  if (p === "/api/v1/interviews/1/capsule" && req.method === "POST") {
    const { receipt } = await body(req);
    const sigs = receipt.signatures;
    const ok = sigs.some((s) => s.role === "fellow" && s.publicKey === users.fellow.signing_public_key) && sigs.some((s) => s.role === "historian" && s.publicKey === users.historian.signing_public_key);
    if (!ok) return json(res, 422, { error: "The receipt's signatures don't match the registered keys." });
    state.receipt = receipt;
    meeting.status = "sealed";
    
    log("capsule receipt stored", receipt.manifestSha256.slice(0, 16));
    return json(res, 201, { ok: true });
  }
  // ---- recovery (mirrors Api::V1::RecoveriesController)
  const recPayload = (r) => ({ id: r.id, status: r.status, release_after: new Date().toISOString(),
    contacts: safety.contacts.map((c) => ({ name: c.name, role: c.role, approved: r.approvals.some((a) => a.sha === c.piece_sha256), blocked: r.blockedBy === c.piece_sha256 })),
    // As in the Rails app: helpers' pieces reach the new computer only once Sondage's is released.
    pieces: r.released && r.status === "pending" ? r.approvals.map((a) => ({ from: a.name, encrypted_piece: a.encrypted_piece })) : [],
    sondage: { released: r.released, piece: r.released && r.status === "pending" ? safety.sondageShare : null } });
  if (p === "/api/v1/recoveries" && req.method === "POST") {
    const b = await body(req);
    safety.recoveries.forEach((r) => r.status === "pending" && (r.status = "cancelled"));
    const r = { id: safety.recoveries.length + 1, recipient: b.recipient, status: "pending", approvals: [], released: false, created: new Date().toISOString(), client: b.client };
    safety.recoveries.push(r);
    log("recovery requested", r.id, "— emails would go to", safety.contacts.map((c) => c.email).join(", "));
    return json(res, 201, recPayload(r));
  }
  let m;
  if ((m = p.match(/^\/api\/v1\/recoveries\/(\d+)(\/complete)?$/))) {
    const r = safety.recoveries.find((x) => x.id === +m[1]);
    if (!r) return json(res, 404, { error: "Not found" });
    if (m[2]) { r.status = "complete"; log("recovery complete", r.id); return json(res, 200, { ok: true }); }
    return json(res, 200, recPayload(r));
  }
  // ---- after a Fellow's death
  if (p === "/api/v1/heirs" && req.method === "PUT") {
    const b = await body(req);
    safety.contacts.forEach((c) => (c.heir = c.role === "family" && b.heir_contact_ids.includes(c.id)));
    log("heirs chosen:", safety.contacts.filter((c) => c.heir).map((c) => c.name).join(", ") || "none");
    return json(res, 200, { heirs: safety.contacts.filter((c) => c.heir).map(({ id, name }) => ({ id, name })) });
  }
  const isHeir = () => tokens.get((req.headers.authorization || "").replace("Bearer ", "")) === "heir";
  if (p === "/api/v1/inheritances") {
    if (!isHeir()) return json(res, 403, { error: "forbidden" });
    const r = safety.recoveries.filter((x) => x.inheritance).at(-1);
    return json(res, 200, { inheritances: ["confirmed", "complete"].includes(claim.status) ? [{ id: 1, status: claim.status, release_after: claim.release_after, fellow: { id: 1, name: users.fellow.name, age_recipient: fellow.age_recipient, signing_public_key: users.fellow.signing_public_key }, recovery: r ? { id: r.id, status: r.status } : null }] : [] });
  }
  if (p === "/api/v1/inheritances/1/recovery" && req.method === "POST") {
    const b = await body(req);
    safety.recoveries.forEach((r) => r.status === "pending" && (r.status = "cancelled"));
    const r = { id: safety.recoveries.length + 1, recipient: b.recipient, status: "pending", approvals: [], released: false, created: new Date().toISOString(), client: b.client, inheritance: true };
    safety.recoveries.push(r);
    log("heir asked for the key (recovery", r.id + ")");
    return json(res, 201, { id: r.id, status: r.status, release_after: claim.release_after });
  }
  if ((jm2 = p.match(/^\/api\/v1\/inheritances\/1\/recovery\/(\d+)(\/complete)?$/))) {
    const r = safety.recoveries.find((x) => x.id === +jm2[1] && x.inheritance);
    if (!r) return json(res, 404, { error: "Not found" });
    if (jm2[2]) { r.status = "complete"; claim.status = "complete"; log("heir has the key"); return json(res, 200, { ok: true }); }
    const heirSha = claim.contactSha;
    return json(res, 200, { id: r.id, status: r.status, release_after: claim.release_after, approved_by_you: r.approvals.some((a) => a.sha === heirSha),
      // As in the Rails app: only the heir's own piece, and only the unlocking half of Sondage's.
      pieces: r.released && r.status === "pending" ? r.approvals.filter((a) => a.sha === heirSha).map((a) => ({ encrypted_piece: a.encrypted_piece })) : [],
      sondage: { released: r.released, piece: r.released && r.status === "pending" ? unlockingHalf(safety.sondageShare) : null } });
  }
  if (p === "/test/confirm-death" && req.method === "POST") { claim.status = "confirmed"; claim.release_after = new Date().toISOString(); log("admin confirmed the death"); return json(res, 200, {}); }

  if (p === "/safety") return file(res, new URL("./safety.html", import.meta.url).pathname);
  if (p.startsWith("/safety/") && req.method === "POST") {
    const b = await body(req);
    const c = safety.contacts.find((x) => x.piece_sha256 === b.piece_sha256);
    if (!c) return json(res, 404, { error: "This safety link isn't recognised." });
    const r = safety.recoveries.find((x) => x.status === "pending");
    const active = ["reported", "confirmed"].includes(claim.status);
    if (p === "/safety/lookup") return json(res, 200, { contact: { name: c.name, role: c.role, heir: !!c.heir }, fellow: { name: users.fellow.name, deceased: claim.status && claim.status !== "reported" && claim.status !== "refused" },
      recovery: r && { id: r.id, requested_at: r.created, client: r.client, recipient: r.recipient, already_approved: r.approvals.some((a) => a.sha === c.piece_sha256), inheritance: r.inheritance ? { heir: safety.contacts.find((x) => x.piece_sha256 === claim.contactSha)?.name, mine: c.piece_sha256 === claim.contactSha } : false },
      inheritance: active ? { status: claim.status, reported_by: safety.contacts.find((x) => x.piece_sha256 === claim.contactSha)?.name } : null,
      can_report_death: !!c.heir && !claim.status });
    if (p === "/safety/report_death") {
      if (!c.heir) return json(res, 403, { error: "Only someone chosen can tell us here." });
      Object.assign(claim, { status: "reported", contactSha: c.piece_sha256 });
      log(`${c.name} reported the death; admins and the Fellow's own address emailed`);
      return json(res, 200, { ok: true });
    }
    if (!r || r.id !== b.recovery_id) return json(res, 404, { error: "There's no request right now." });
    if (p === "/safety/approve" && r.inheritance && c.piece_sha256 !== claim.contactSha) return json(res, 403, { error: "Only the heir needs to confirm this." });
    if (p === "/safety/approve") { if (!r.approvals.some((a) => a.sha === c.piece_sha256)) r.approvals.push({ sha: c.piece_sha256, name: c.name, encrypted_piece: b.encrypted_piece }); log("approved by", c.name); return json(res, 200, { ok: true }); }
    if (p === "/safety/deny") { r.status = "blocked"; r.blockedBy = c.piece_sha256; log("blocked by", c.name); return json(res, 200, { ok: true }); }
  }
  // Stands in for an admin pressing "Release Sondage's safety copy"
  if (p === "/test/release" && req.method === "POST") {
    const r = safety.recoveries.find((x) => x.status === "pending");
    if (r) r.released = true;
    log("admin released Sondage's copy");
    return json(res, 200, { ok: !!r });
  }
  if (p === "/signing_key" && req.method === "PATCH") {
    const b = await body(req);
    users.historian.signing_public_key = b.signing_public_key;
    log("historian key registered", b.signing_public_key.slice(0, 12));
    return json(res, 200, { ok: true });
  }
  if (p === "/room") {
    const ice = iceFor(2);
    let html = fs.readFileSync(new URL("./room.html", import.meta.url), "utf8").replace('data-media-type="audio"', `data-media-type="${meeting.media_type}"`)
      .replace('data-ice-servers="[]"', `data-ice-servers="${JSON.stringify(ice.ice_servers).replace(/"/g, "&quot;")}" data-relay-only="${ice.relay_only}"`);
    if (meeting.media_type === "video") html = html.replace('class="stage audio-only"', 'class="stage "');
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    return res.end(html);
  }
  if (p === "/timeline") return file(res, new URL("./timeline.html", import.meta.url).pathname);
  if (p.startsWith("/sondage/v/")) return file(res, path.join(ROOT, "web/public/sondage", p.split("/").slice(4).join("/")));
  if (p.startsWith("/sondage/")) return file(res, path.join(ROOT, "web/public", p));
  if (p === "/assets/application.css") return file(res, path.join(ROOT, "web/app/assets/stylesheets/application.css"));
  if (p === "/assets/room.css") return file(res, path.join(ROOT, "web/app/assets/stylesheets/room.css"));
  if (p === "/assets/timeline.css") return file(res, path.join(ROOT, "web/app/assets/stylesheets/timeline.css"));
  if (p === "/assets/actioncable.esm.js") return file(res, path.join(ROOT, "desktop/node_modules/@rails/actioncable/app/assets/javascripts/actioncable.esm.js"));
  if (p.startsWith("/seed_images/")) return file(res, path.join(ROOT, "web/db", p));
  json(res, 404, { error: "not found" });
});

// ---- Action Cable protocol (actioncable-v1-json)
const wss = new WebSocketServer({ server, path: "/cable", handleProtocols: (protos) => (protos.has("actioncable-v1-json") ? "actioncable-v1-json" : false) });
const subs = new Map(); // ws -> [{identifier, interviewId}]
wss.on("connection", (ws, req) => {
  const token = new URL(req.url, "http://x").searchParams.get("token");
  const role = token && tokens.has(token) ? "fellow" : "historian";
  ws.send(JSON.stringify({ type: "welcome" }));
  const ping = setInterval(() => ws.readyState === 1 && ws.send(JSON.stringify({ type: "ping", message: Math.floor(Date.now() / 1000) })), 3000);
  ws.on("close", () => { clearInterval(ping); subs.delete(ws); });
  ws.on("message", (raw) => {
    const m = JSON.parse(raw);
    const id = JSON.parse(m.identifier);
    if (m.command === "subscribe") {
      subs.set(ws, [...(subs.get(ws) || []), { identifier: m.identifier, interviewId: String(id.interview_id) }]);
      ws.send(JSON.stringify({ identifier: m.identifier, type: "confirm_subscription" }));
      log(role, "subscribed to interview", id.interview_id);
    } else if (m.command === "message") {
      const data = JSON.parse(m.data);
      const payload = { ...data.payload, from: role };
      if (!["ping", "ready", "offer", "answer", "ice", "bye"].includes(payload.type)) return;
      if (payload.type !== "ice") log(role, "->", payload.type);
      for (const [other, list] of subs) for (const s of list) if (s.interviewId === String(id.interview_id)) other.send(JSON.stringify({ identifier: s.identifier, message: payload }));
    }
  });
});

server.listen(PORT, () => log(`stand-in server on http://localhost:${PORT}`));
