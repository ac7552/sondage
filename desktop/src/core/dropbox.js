// The Senior Fellow's own Dropbox, as the cloud copy of each Sitting.
//
// Sondage holds nothing here. The Senior Fellow (with a helper) connects their own
// Dropbox once; the sign-in token is kept in this computer's keychain only. The
// Dropbox app is set to "App folder", so the app can only see its own folder
// (Dropbox → Apps → <app name>), never the rest of their Dropbox.
//
// Every upload is checked: Dropbox reports a content hash for the file it stored,
// and it must equal the hash of the file on this computer.

import fs from "node:fs";
import fsp from "node:fs/promises";
import crypto from "node:crypto";

export const REDIRECT_PORT = 53682;
export const REDIRECT_URI = `http://127.0.0.1:${REDIRECT_PORT}/dropbox`;
export const SCOPES = ["account_info.read", "files.metadata.read", "files.content.write"];
const SINGLE_LIMIT = 150 * 1024 * 1024; // Dropbox's limit for a one-request upload
const PART = 8 * 1024 * 1024; // upload-session pieces (a multiple of 4 MiB)

const b64url = (buf) => Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

// ---------------------------------------------------------------- sign-in (OAuth 2 with PKCE, no secret)

export function startAuthorization(appKey) {
  const verifier = b64url(crypto.randomBytes(48));
  const challenge = b64url(crypto.createHash("sha256").update(verifier).digest());
  const state = b64url(crypto.randomBytes(16));
  const url = new URL("https://www.dropbox.com/oauth2/authorize");
  url.search = new URLSearchParams({
    client_id: appKey,
    response_type: "code",
    code_challenge: challenge,
    code_challenge_method: "S256",
    token_access_type: "offline",
    redirect_uri: REDIRECT_URI,
    scope: SCOPES.join(" "),
    state,
  }).toString();
  return { url: url.toString(), verifier, state };
}

export async function exchangeCode({ appKey, code, verifier, fetchImpl = fetch }) {
  const res = await fetchImpl("https://api.dropboxapi.com/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code, grant_type: "authorization_code", client_id: appKey, code_verifier: verifier, redirect_uri: REDIRECT_URI }).toString(),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.refresh_token) throw new Error(`Dropbox didn't accept the sign-in (${data.error_description || data.error || res.status}).`);
  return data;
}

// ---------------------------------------------------------------- Dropbox's content hash

// SHA-256 of each 4 MiB block, concatenated, then SHA-256 of that.
// https://www.dropbox.com/developers/reference/content-hash
export async function contentHash(file) {
  const BLOCK = 4 * 1024 * 1024;
  const blocks = [];
  let current = crypto.createHash("sha256");
  let inBlock = 0;
  for await (const chunk of fs.createReadStream(file, { highWaterMark: 1024 * 1024 })) {
    let off = 0;
    while (off < chunk.length) {
      const take = Math.min(BLOCK - inBlock, chunk.length - off);
      current.update(chunk.subarray(off, off + take));
      inBlock += take;
      off += take;
      if (inBlock === BLOCK) {
        blocks.push(current.digest());
        current = crypto.createHash("sha256");
        inBlock = 0;
      }
    }
  }
  if (inBlock > 0) blocks.push(current.digest());
  return crypto.createHash("sha256").update(Buffer.concat(blocks)).digest("hex");
}

// ---------------------------------------------------------------- the client

export class Dropbox {
  // auth: { appKey, refreshToken }, onToken(newAccess) is optional
  constructor({ appKey, refreshToken, fetchImpl = fetch, retries = 4, wait = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
    this.appKey = appKey;
    this.refreshToken = refreshToken;
    this.fetch = fetchImpl;
    this.retries = retries;
    this.wait = wait;
    this.access = null;
    this.accessUntil = 0;
  }

  async #token() {
    if (this.access && Date.now() < this.accessUntil - 60_000) return this.access;
    const res = await this.fetch("https://api.dropboxapi.com/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: this.refreshToken, client_id: this.appKey }).toString(),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.access_token) {
      const e = new Error("Dropbox needs connecting again.");
      e.reconnect = true;
      throw e;
    }
    this.access = data.access_token;
    this.accessUntil = Date.now() + (data.expires_in || 3600) * 1000;
    return this.access;
  }

  // One API call, retried on network trouble, rate limits and server errors.
  async #call(url, { arg, body, rpc = false }) {
    for (let attempt = 0; ; attempt++) {
      let res;
      try {
        const headers = { Authorization: `Bearer ${await this.#token()}` };
        if (rpc) headers["Content-Type"] = "application/json";
        else {
          headers["Content-Type"] = "application/octet-stream";
          if (arg !== undefined) headers["Dropbox-API-Arg"] = JSON.stringify(arg);
        }
        res = await this.fetch(url, { method: "POST", headers, body: rpc ? JSON.stringify(arg ?? null) : body ?? Buffer.alloc(0) });
      } catch (err) {
        if (err.reconnect || attempt >= this.retries) throw err;
        await this.wait(1000 * 2 ** attempt);
        continue;
      }
      if (res.ok) return res.json();
      const text = await res.text();
      if (res.status === 401) this.access = null;
      if ((res.status === 429 || res.status >= 500 || res.status === 401) && attempt < this.retries) {
        await this.wait(Number(res.headers.get?.("retry-after")) * 1000 || 1000 * 2 ** attempt);
        continue;
      }
      const e = new Error(`Dropbox answered ${res.status}: ${text.slice(0, 300)}`);
      e.status = res.status;
      e.body = text;
      throw e;
    }
  }

  account() {
    return this.#call("https://api.dropboxapi.com/2/users/get_current_account", { rpc: true });
  }

  metadata(path) {
    return this.#call("https://api.dropboxapi.com/2/files/get_metadata", { rpc: true, arg: { path } });
  }

  // Uploads a local file to `remote` (inside the app folder) and checks that what
  // Dropbox stored is identical. Never overwrites a different file of the same name.
  async upload(local, remote, { onProgress } = {}) {
    const expected = await contentHash(local);
    const size = (await fsp.stat(local)).size;
    const commit = { path: remote, mode: "add", autorename: false, mute: true };
    let meta;
    try {
      if (size <= SINGLE_LIMIT) {
        meta = await this.#call("https://content.dropboxapi.com/2/files/upload", { arg: commit, body: await fsp.readFile(local) });
        onProgress?.(size, size);
      } else {
        meta = await this.#session(local, size, commit, onProgress);
      }
    } catch (err) {
      // Already there (a retry after a dropped connection): fine if it's the same file.
      if (err.status === 409 && /conflict/.test(err.body || "")) {
        meta = await this.metadata(remote);
        if (meta.content_hash !== expected) throw new Error(`${remote} is already in Dropbox with different contents. Nothing was overwritten.`);
        onProgress?.(size, size);
        return { ...meta, verified: true, alreadyThere: true };
      }
      throw err;
    }
    if (meta.content_hash !== expected) throw new Error(`${remote} didn't arrive in Dropbox intact.`);
    return { ...meta, verified: true };
  }

  async #session(local, size, commit, onProgress) {
    const fh = await fsp.open(local, "r");
    try {
      const read = async (offset) => {
        const buf = Buffer.alloc(Math.min(PART, size - offset));
        await fh.read(buf, 0, buf.length, offset);
        return buf;
      };
      const first = await read(0);
      const { session_id } = await this.#call("https://content.dropboxapi.com/2/files/upload_session/start", { arg: { close: false }, body: first });
      let offset = first.length;
      onProgress?.(offset, size);
      while (size - offset > PART) {
        const buf = await read(offset);
        await this.#call("https://content.dropboxapi.com/2/files/upload_session/append_v2", { arg: { cursor: { session_id, offset }, close: false }, body: buf });
        offset += buf.length;
        onProgress?.(offset, size);
      }
      const last = await read(offset);
      const meta = await this.#call("https://content.dropboxapi.com/2/files/upload_session/finish", { arg: { cursor: { session_id, offset }, commit }, body: last });
      onProgress?.(size, size);
      return meta;
    } finally {
      await fh.close();
    }
  }
}
