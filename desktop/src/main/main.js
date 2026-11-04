// Sondage desktop — main process.
// Holds the Fellow's keys, writes every recorded chunk to disk, and seals capsules.
// The window never sees a private key: it asks this process to sign and seal.

import { app, BrowserWindow, ipcMain, session, dialog, shell, systemPreferences, protocol } from "electron";
import fs from "node:fs";
import { Readable } from "node:stream";
import path from "node:path";
import fsp from "node:fs/promises";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import * as store from "./store.js";
import * as keys from "../core/keys.js";
import { RecordingSession } from "../core/capsule.js";
import { Decrypter, generateX25519Identity, identityToRecipient } from "age-encryption";
import os from "node:os";
import { openAndVerify, readReceipt, checkAgainstReceipt } from "../core/verify.js";

const here = path.dirname(fileURLToPath(import.meta.url));

// Development switches (never set in a release build):
//   SONDAGE_USER_DATA   keep this run's settings and keys in a separate folder
//   SONDAGE_FAKE_MEDIA  use a synthetic microphone and camera, for automated tests
if (process.env.SONDAGE_USER_DATA) app.setPath("userData", process.env.SONDAGE_USER_DATA);
if (process.env.SONDAGE_FAKE_MEDIA) {
  app.commandLine.appendSwitch("use-fake-device-for-media-stream");
  app.commandLine.appendSwitch("use-fake-ui-for-media-stream");
}
const sessions = new Map(); // interview id -> RecordingSession

// Opened recordings play from a private temporary folder through this app-only
// address; the folder is deleted when the app closes.
protocol.registerSchemesAsPrivileged([{ scheme: "sondage-media", privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true } }]);
const listenRoot = path.join(app.getPath("temp"), `sondage-listen-${process.pid}`);
app.on("will-quit", () => fs.rmSync(listenRoot, { recursive: true, force: true }));

function createWindow() {
  const win = new BrowserWindow({
    width: 1240,
    height: 860,
    minWidth: 960,
    minHeight: 680,
    title: "Sondage",
    backgroundColor: "#f6f3ec",
    webPreferences: {
      preload: path.join(here, "preload.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(path.join(here, "..", "renderer", "index.html"));
  // Links open in the person's browser, never inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
}

app.whenReady().then(async () => {
  // Only microphone and camera are ever allowed.
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => callback(permission === "media"));
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => permission === "media");
  if (process.platform === "darwin") {
    await systemPreferences.askForMediaAccess("microphone").catch(() => {});
    await systemPreferences.askForMediaAccess("camera").catch(() => {});
  }
  protocol.handle("sondage-media", (req) => {
    const u = new URL(req.url);
    const file = path.resolve(listenRoot, u.hostname, "." + decodeURIComponent(u.pathname));
    if (!file.startsWith(listenRoot + path.sep) || !fs.existsSync(file)) return new Response("Not found", { status: 404 });
    // Serve byte ranges so the player can jump to any point in a long recording.
    const size = fs.statSync(file).size;
    const type = file.endsWith(".wav") ? "audio/wav" : file.endsWith(".webm") ? "video/webm" : "application/octet-stream";
    const m = (req.headers.get("range") || "").match(/bytes=(\d*)-(\d*)/);
    if (!m) return new Response(Readable.toWeb(fs.createReadStream(file)), { status: 200, headers: { "Content-Type": type, "Content-Length": String(size), "Accept-Ranges": "bytes" } });
    const start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]));
    const end = m[1] && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
    if (start >= size) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
    return new Response(Readable.toWeb(fs.createReadStream(file, { start, end })), {
      status: 206,
      headers: { "Content-Type": type, "Content-Length": String(end - start + 1), "Content-Range": `bytes ${start}-${end}/${size}`, "Accept-Ranges": "bytes" },
    });
  });
  createWindow();
  app.on("activate", () => BrowserWindow.getAllWindows().length === 0 && createWindow());
});
app.on("window-all-closed", () => process.platform !== "darwin" && app.quit());

const handle = (channel, fn) =>
  ipcMain.handle(channel, async (_e, arg) => {
    try {
      return { ok: true, value: await fn(arg || {}) };
    } catch (err) {
      return { ok: false, error: String(err.message || err) };
    }
  });

// ---------------------------------------------------------------- settings

handle("config:get", () => {
  const c = store.config();
  const auth = store.readSecret("auth");
  return { ...c, signedIn: !!auth, user: auth?.user || null, platform: process.platform, keychain: store.keychainAvailable(), version: app.getVersion() };
});
handle("config:set", ({ serverUrl, vaultDir, tsaUrl }) => store.writeConfig({ ...(serverUrl ? { serverUrl: serverUrl.replace(/\/+$/, "") } : {}), ...(vaultDir ? { vaultDir } : {}), ...(tsaUrl !== undefined ? { tsaUrl } : {}) }));
handle("vault:choose", async () => {
  const r = await dialog.showOpenDialog({ title: "Choose where your sealed capsules are kept", properties: ["openDirectory", "createDirectory"] });
  if (r.canceled || !r.filePaths[0]) return null;
  store.writeConfig({ vaultDir: r.filePaths[0] });
  return r.filePaths[0];
});

// ---------------------------------------------------------------- web app API

async function api(method, pathname, body) {
  const { serverUrl } = store.config();
  const auth = store.readSecret("auth");
  const res = await fetch(serverUrl + pathname, {
    method,
    headers: { "Content-Type": "application/json", Accept: "application/json", ...(auth ? { Authorization: `Bearer ${auth.token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    // An HTML page instead of JSON: usually a server error, or another program on that address.
    const title = (text.match(/<title>([^<]*)<\/title>/i) || [])[1] || "";
    const h1 = (text.match(/<h1>([^<]*)<\/h1>/i) || [])[1] || "";
    throw new Error(`The server at ${serverUrl} answered with a web page instead of data (status ${res.status}${h1 || title ? `: ${(h1 || title).trim()}` : ""}). Check the Terminal window running the Sondage web app for the error.`);
  }
  if (!res.ok) throw new Error(data.error || `The Sondage server answered ${res.status}`);
  return data;
}

handle("auth:signIn", async ({ serverUrl, email, password }) => {
  if (serverUrl) store.writeConfig({ serverUrl: serverUrl.replace(/\/+$/, "") });
  const data = await api("POST", "/api/v1/session", { email, password, client: `Sondage desktop ${app.getVersion()}` });
  if (data.user.role !== "fellow") throw new Error("The desktop app is for the Fellow. Historians and admins use the web app.");
  store.writeSecret("auth", { token: data.token, user: data.user });
  return data.user;
});
handle("auth:signOut", async () => {
  await api("DELETE", "/api/v1/session").catch(() => {});
  store.deleteSecret("auth");
  return true;
});
handle("api", ({ method = "GET", path: p, body }) => api(method, p, body));
handle("cable:url", () => {
  const { serverUrl } = store.config();
  const auth = store.readSecret("auth");
  return `${serverUrl.replace(/^http/, "ws")}/cable?token=${encodeURIComponent(auth?.token || "")}`;
});

// ---------------------------------------------------------------- keys

function fellowKeys() {
  const k = store.readSecret("fellow-keys");
  if (!k) throw new Error("This computer has no Fellow key yet");
  return k;
}
handle("keys:status", () => {
  const k = store.readSecret("fellow-keys");
  return k ? { hasKeys: true, signingPublicKey: k.signingPublicKey, ageRecipient: k.ageRecipient, fingerprint: keys.fingerprint(k.signingPublicKey), createdAt: k.createdAt } : { hasKeys: false };
});
// Four safety copies: the Fellow, two family members, and Sondage. Any two rebuild the key.
const SAFETY = { shares: 4, threshold: 2 };
const pieceHex = (share) => share.replace(/^SONDAGE-\d+[\s:]+/i, "").replace(/\s+/g, "").toUpperCase();
const pieceSha256 = (share) => crypto.createHash("sha256").update(Buffer.from(pieceHex(share), "hex")).digest("hex");

handle("keys:create", async () => {
  if (store.readSecret("fellow-keys")) throw new Error("A key already exists on this computer");
  const k = await keys.generateFellowKeys();
  // Made once and kept, so re-sent emails match the ones family already hold.
  k.recoveryShares = await keys.splitForRecovery(k, SAFETY);
  store.writeSecret("fellow-keys", k);
  return { ...keys.publicPart(k), fingerprint: keys.fingerprint(k.signingPublicKey) };
});

// contacts: [{ name, email, role: "self" | "family" }] — the first three safety copies, in order.
// Sondage receives the fourth copy, and only a fingerprint of the others.
handle("keys:register", async ({ contacts }) => {
  const k = fellowKeys();
  // Keys made by an earlier version of the app had a different set of copies: make the four now.
  if ((k.recoveryShares || []).length !== SAFETY.shares) {
    k.recoveryShares = await keys.splitForRecovery(k, SAFETY);
    store.writeSecret("fellow-keys", k);
  }
  const shares = k.recoveryShares;
  if (!Array.isArray(contacts) || contacts.length !== 3) throw new Error("Please fill in all three people.");
  k.safetyContacts = contacts.map((c, i) => ({ name: c.name.trim(), email: c.email.trim(), role: c.role, index: i }));
  store.writeSecret("fellow-keys", k);
  return api("PUT", "/api/v1/keys", {
    signing_public_key: k.signingPublicKey,
    age_recipient: k.ageRecipient,
    sondage_share: pieceHex(shares[3]),
    safety_contacts: k.safetyContacts.map((c) => ({ name: c.name, email: c.email, role: c.role, piece_sha256: pieceSha256(shares[c.index]) })),
  });
});

handle("keys:contacts", () => (fellowKeys().safetyContacts || []).map(({ name, email, role }) => ({ name, email, role })));

// Opens the Fellow's own email app with a safety email ready to send. It goes from
// them, never through Sondage, so Sondage never sees anyone else's safety copy.
handle("keys:mail", async ({ index, fellowName }) => {
  const k = fellowKeys();
  const c = (k.safetyContacts || [])[index];
  if (!c) throw new Error("Unknown safety contact");
  const link = `${store.config().serverUrl}/safety#${pieceHex(k.recoveryShares[index])}`;
  const me = fellowName.split(" ")[0];
  const subject = "My Sondage safety copy";
  const body = c.role === "self"
    ? `This email holds my own safety copy of the key to my Sondage recordings. On its own it can't open anything.\n\nKeep this email. If I ever lose access to my recordings, Sondage will email me, and I'll click this link:\n\n${link}\n`
    : `Hi ${c.name.split(" ")[0]},\n\nI'm recording my life story with Sondage. This email holds one of four safety copies of the key to my recordings. On its own it can't open anything.\n\nPlease keep this email. If I ever lose access to my recordings, Sondage will email you, and you'll just click this link to help me:\n\n${link}\n\nYou don't need to do anything now. Thank you!\n\n${me}\n`;
  const url = `mailto:${encodeURIComponent(c.email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  if (process.env.SONDAGE_MAIL_LOG) {
    // Automated tests: record the email instead of opening a mail app.
    await fsp.appendFile(process.env.SONDAGE_MAIL_LOG, JSON.stringify({ to: c.email, role: c.role, subject, body, link }) + "\n");
  } else {
    await shell.openExternal(url);
  }
  return true;
});

// Typed-in or pasted safety copies (a fallback when email isn't available).
handle("keys:restore", async ({ shares, expectedPublicKey }) => {
  const k = await keys.restoreFromShares(shares);
  // Copies from two different sets combine into a key that belongs to nobody.
  if (expectedPublicKey && k.signingPublicKey !== expectedPublicKey) {
    throw new Error("These safety copies don't restore the key for your account. Check that both belong to you.");
  }
  store.writeSecret("fellow-keys", k);
  return { ...keys.publicPart(k), fingerprint: keys.fingerprint(k.signingPublicKey) };
});
handle("keys:shares", async () => fellowKeys().recoveryShares || []);

// ---------------------------------------------------------------- recovery on a new computer
//
// This computer makes a one-time key and asks Sondage to start a recovery. Each
// person who approves encrypts their safety copy to that one-time key, so the copies
// only ever come together here. Two are enough.

handle("recovery:start", async () => {
  const identity = await generateX25519Identity();
  const recipient = await identityToRecipient(identity);
  const r = await api("POST", "/api/v1/recoveries", { recipient, client: `Sondage app on ${os.hostname()}` });
  store.writeSecret("recovery", { id: r.id, identity });
  return r;
});

handle("recovery:status", async () => {
  const saved = store.readSecret("recovery");
  if (!saved) return null;
  const r = await api("GET", `/api/v1/recoveries/${saved.id}`);
  if (r.status !== "pending") {
    store.deleteSecret("recovery");
    return { ...r, done: false };
  }
  const pieces = [];
  for (const p of r.pieces) {
    try {
      const d = new Decrypter();
      d.addIdentity(saved.identity);
      pieces.push(await d.decrypt(Uint8Array.from(Buffer.from(p.encrypted_piece, "base64")), "text"));
    } catch {}
  }
  if (r.sondage.piece) pieces.push(r.sondage.piece);
  const summary = { status: r.status, contacts: r.contacts, sondage: { released: r.sondage.released }, release_after: r.release_after, pieces: pieces.length };
  if (pieces.length < 2) return { ...summary, done: false };

  // Try pairs until one rebuilds the key registered for this account.
  const me = await api("GET", "/api/v1/me");
  const expected = me.fellow?.signing_public_key;
  for (let i = 0; i < pieces.length; i++) {
    for (let j = i + 1; j < pieces.length; j++) {
      try {
        const k = await keys.restoreFromShares([pieces[i], pieces[j]]);
        if (expected && k.signingPublicKey !== expected) continue;
        store.writeSecret("fellow-keys", k);
        store.deleteSecret("recovery");
        await api("POST", `/api/v1/recoveries/${saved.id}/complete`).catch(() => {});
        return { ...summary, done: true, fingerprint: keys.fingerprint(k.signingPublicKey) };
      } catch {}
    }
  }
  return { ...summary, done: false, problem: "The safety copies received so far don't fit together. Sondage has been told." };
});
handle("recovery:cancel", () => {
  store.deleteSecret("recovery");
  return true;
});

// ---------------------------------------------------------------- recording

async function rec(id) {
  if (!sessions.has(id)) sessions.set(id, await RecordingSession.open(store.stagingRoot(), id));
  return sessions.get(id);
}
handle("rec:open", async ({ sessionId, meta }) => {
  const s = await RecordingSession.open(store.stagingRoot(), sessionId, meta);
  sessions.set(String(sessionId), s);
  s.log("fellow", "joined", meta?.title);
  await s.save();
  return s.trackStatus();
});
handle("rec:log", async ({ sessionId, actor, action, detail }) => {
  const s = await rec(String(sessionId));
  s.log(actor, action, detail);
  await s.save();
  return true;
});
handle("rec:track", async ({ sessionId, track }) => (await rec(String(sessionId))).ensureTrack(track).then(() => true));
handle("rec:chunk", async ({ sessionId, trackId, index, bytes, expectedSha256, sampleStart, sampleCount }) => {
  const s = await rec(String(sessionId));
  return s.writeChunk(trackId, index, bytes, { expectedSha256, sampleStart, sampleCount });
});
handle("rec:endTrack", async ({ sessionId, trackId, summary }) => (await rec(String(sessionId))).endTrack(trackId, summary).then(() => true));
handle("rec:status", async ({ sessionId }) => (await rec(String(sessionId))).trackStatus());
handle("rec:discard", async ({ sessionId }) => {
  const s = await rec(String(sessionId));
  await fsp.rm(s.dir, { recursive: true, force: true });
  sessions.delete(String(sessionId));
  return true;
});

handle("rec:manifest", async ({ sessionId, context }) => {
  const s = await rec(String(sessionId));
  const k = fellowKeys();
  const timeline = await api("GET", "/api/v1/fellow/timeline").catch(() => null);
  const built = await s.buildManifest({
    ...context,
    capsuleId: context.capsuleId || crypto.randomUUID(),
    fellow: { ...context.fellow, signingPublicKey: k.signingPublicKey, ageRecipient: k.ageRecipient },
    timeline,
    software: { app: "Sondage desktop", version: app.getVersion(), electron: process.versions.electron, chromium: process.versions.chrome, os: `${process.platform} ${process.arch}` },
  });
  return { manifestText: built.manifestText, manifestSha256: built.manifestSha256, capsuleId: built.manifest.capsuleId };
});

handle("rec:seal", async ({ sessionId, historianSignature, historianPublicKey }) => {
  const s = await rec(String(sessionId));
  const c = store.config();
  const result = await s.seal({ fellowKeys: fellowKeys(), historianSignature, historianPublicKey, vaultDir: c.vaultDir, tsaUrl: c.tsaUrl || null });
  sessions.delete(String(sessionId));
  return result;
});

// ---------------------------------------------------------------- vault

handle("vault:list", async () => {
  const { vaultDir } = store.config();
  let names = [];
  try {
    names = await fsp.readdir(vaultDir);
  } catch {
    return [];
  }
  const out = [];
  for (const n of names.filter((x) => x.endsWith(".receipt.json"))) {
    try {
      const r = await readReceipt(path.join(vaultDir, n));
      const capsulePath = path.join(vaultDir, r.capsuleFile);
      const present = await fsp.stat(capsulePath).then(() => true, () => false);
      out.push({ ...r, receiptPath: path.join(vaultDir, n), capsulePath, present });
    } catch {}
  }
  return out.sort((a, b) => b.sealedAt.localeCompare(a.sealedAt));
});
handle("vault:verify", async ({ capsulePath, receiptPath }) => {
  const receipt = await readReceipt(receiptPath);
  const matches = await checkAgainstReceipt(capsulePath, receipt);
  const r = await openAndVerify(capsulePath, fellowKeys().ageIdentity);
  await r.cleanup();
  return { ok: matches && r.ok, checks: [{ name: "Sealed file matches its receipt", ok: matches }, ...r.checks] };
});
handle("vault:openCopy", async ({ capsulePath }) => {
  const pick = await dialog.showOpenDialog({ title: "Choose a folder for an opened copy", properties: ["openDirectory", "createDirectory"] });
  if (pick.canceled || !pick.filePaths[0]) return null;
  const dest = path.join(pick.filePaths[0], path.basename(capsulePath).replace(/\.capsule\.age$/, ""));
  await fsp.mkdir(dest, { recursive: true });
  const r = await openAndVerify(capsulePath, fellowKeys().ageIdentity, { keepDir: dest });
  shell.showItemInFolder(path.join(dest, "v1", "content", "manifest.json"));
  return { dest, ok: r.ok };
});
handle("vault:reveal", ({ file }) => shell.showItemInFolder(file));
handle("vault:listen", async ({ capsulePath }) => {
  const id = crypto.createHash("sha256").update(capsulePath).digest("hex").slice(0, 16);
  const dir = path.join(listenRoot, id);
  if (!fs.existsSync(path.join(dir, "v1", "content", "manifest.json"))) {
    await fsp.mkdir(dir, { recursive: true });
    const r = await openAndVerify(capsulePath, fellowKeys().ageIdentity, { keepDir: dir });
    if (!r.manifest) throw new Error("This recording couldn't be opened.");
  }
  const manifest = JSON.parse(await fsp.readFile(path.join(dir, "v1", "content", "manifest.json"), "utf8"));
  const order = (t) => (t.kind === "audio" ? 0 : 1) * 10 + (t.role === "fellow" ? 0 : 1);
  // Each part starts at the moment it was recorded, so parts play in order, not on top of each other.
  const starts = manifest.tracks.map((t) => Date.parse(t.recording?.startedAt || "")).filter((n) => !Number.isNaN(n));
  const t0 = starts.length ? Math.min(...starts) : 0;
  const tracks = manifest.tracks.slice().sort((a, b) => order(a) - order(b)).map((t) => {
    const st = Date.parse(t.recording?.startedAt || "");
    return { url: `sondage-media://${id}/v1/content/${t.file}`, kind: t.kind, role: t.role, offset: Number.isNaN(st) ? 0 : (st - t0) / 1000 };
  });
  return { tracks, title: manifest.session.title };
});
