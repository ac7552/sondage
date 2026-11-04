// Stand-in for the Rails app, for end-to-end testing in this sandbox only.
// Mirrors the Rails API used by the desktop app, the Action Cable protocol used
// for signaling, and serves the real historian page scripts and timeline scripts.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { WebSocketServer } from "ws";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const PORT = +process.env.PORT || 3999;
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

const users = {
  fellow: { id: 3, name: "Eleanor Ruiz", email: "eleanor@sondage.test", role: "fellow", password: "sondage-demo-2026", signing_public_key: null },
  historian: { id: 2, name: "Dr. Samuel Reyes", email: "historian@sondage.test", role: "historian", signing_public_key: null },
};
const fellow = { id: 1, age_recipient: null };
const meeting = { id: 1, title: "Life history interview with Eleanor Ruiz", media_type: process.env.MEDIA || "video", status: "scheduled", scheduled_at: new Date(Date.now() + 3600e3).toISOString() };
const tokens = new Set();
const safety = { sondageShare: null, contacts: [], recoveries: [] };
const sha = (hex) => crypto.createHash("sha256").update(Buffer.from(hex, "hex")).digest("hex");
export const state = { receipt: null };

const sample = JSON.parse(fs.readFileSync(new URL("./sample-timeline.json", import.meta.url)));

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
    if (b.email !== users.fellow.email || b.password !== users.fellow.password) return json(res, 401, { error: "That email and password don't match." });
    const t = crypto.randomBytes(20).toString("hex");
    tokens.add(t);
    log("desktop signed in");
    return json(res, 201, { token: t, user: { id: 3, name: users.fellow.name, email: users.fellow.email, role: "fellow" } });
  }
  if (p.startsWith("/api/") && !authed(req)) return json(res, 401, { error: "Please sign in again." });
  if (p === "/api/v1/session" && req.method === "DELETE") return json(res, 204, {});
  if (p === "/api/v1/me") {
    return json(res, 200, {
      user: { id: 3, name: users.fellow.name, email: users.fellow.email, role: "fellow" },
      fellow: { id: 1, name: users.fellow.name, stage: "interview", signing_public_key: users.fellow.signing_public_key, age_recipient: fellow.age_recipient,
        safety_contacts: safety.contacts.map(({ name, email, role }) => ({ name, email, role })), pending_recovery_id: safety.recoveries.find((r) => r.status === "pending")?.id || null },
      interviews: [{ ...meeting, historian: { name: users.historian.name, signing_public_key: users.historian.signing_public_key }, capsule: null, ice_servers: [] }],
    });
  }
  if (p === "/api/v1/keys" && req.method === "PUT") {
    const b = await body(req);
    users.fellow.signing_public_key = b.signing_public_key;
    fellow.age_recipient = b.age_recipient;
    if (b.sondage_share) { safety.sondageShare = b.sondage_share; safety.contacts = b.safety_contacts; }
    log("safety copies registered:", safety.contacts.map((c) => `${c.name} (${c.role})`).join(", "));
    log("fellow key registered", b.signing_public_key.slice(0, 12));
    return json(res, 200, { ok: true });
  }
  if (p === "/api/v1/fellow/timeline") return json(res, 200, sample);
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
    pieces: r.approvals.map((a) => ({ from: a.name, encrypted_piece: a.encrypted_piece })),
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
  if (p === "/safety") return file(res, new URL("./safety.html", import.meta.url).pathname);
  if (p.startsWith("/safety/") && req.method === "POST") {
    const b = await body(req);
    const c = safety.contacts.find((x) => x.piece_sha256 === b.piece_sha256);
    if (!c) return json(res, 404, { error: "This safety link isn't recognised." });
    const r = safety.recoveries.find((x) => x.status === "pending");
    if (p === "/safety/lookup") return json(res, 200, { contact: { name: c.name, role: c.role }, fellow: { name: users.fellow.name }, recovery: r && { id: r.id, requested_at: r.created, client: r.client, recipient: r.recipient, already_approved: r.approvals.some((a) => a.sha === c.piece_sha256) } });
    if (!r || r.id !== b.recovery_id) return json(res, 404, { error: "There's no request right now." });
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
    let html = fs.readFileSync(new URL("./room.html", import.meta.url), "utf8").replace('data-media-type="audio"', `data-media-type="${meeting.media_type}"`);
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
