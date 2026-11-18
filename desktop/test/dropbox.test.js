import { test } from "node:test";
import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { Dropbox, contentHash, startAuthorization, REDIRECT_URI } from "../src/core/dropbox.js";

// A pretend Dropbox that keeps uploaded files in memory and hashes them the way Dropbox does.
function fakeDropbox({ failFirst = 0 } = {}) {
  const files = new Map();
  const sessions = new Map();
  const calls = [];
  let failures = failFirst;
  const hash = (buf) => {
    const blocks = [];
    for (let i = 0; i < buf.length; i += 4 * 1024 * 1024) blocks.push(crypto.createHash("sha256").update(buf.subarray(i, i + 4 * 1024 * 1024)).digest());
    return crypto.createHash("sha256").update(Buffer.concat(blocks)).digest("hex");
  };
  const json = (status, body) => ({ ok: status < 300, status, json: async () => body, text: async () => JSON.stringify(body), headers: { get: () => null } });
  const fetchImpl = async (url, init) => {
    const name = url.replace(/^https:\/\/[^/]+/, "");
    calls.push(name);
    if (name === "/oauth2/token") return json(200, { access_token: "A", expires_in: 14400 });
    if (failures > 0) { failures--; return json(503, { error: "busy" }); }
    const arg = init.headers["Dropbox-API-Arg"] ? JSON.parse(init.headers["Dropbox-API-Arg"]) : JSON.parse(init.body || "null");
    const body = Buffer.isBuffer(init.body) ? init.body : Buffer.alloc(0);
    const store = (p) => {
      if (files.has(p)) return json(409, { error_summary: "path/conflict/file/.." });
      return null;
    };
    if (name === "/2/files/upload") {
      const c = store(arg.path); if (c) return c;
      files.set(arg.path, body);
      return json(200, { path_display: arg.path, content_hash: hash(body) });
    }
    if (name === "/2/files/upload_session/start") { const id = `s${sessions.size}`; sessions.set(id, [body]); return json(200, { session_id: id }); }
    if (name === "/2/files/upload_session/append_v2") { sessions.get(arg.cursor.session_id).push(body); return json(200, null); }
    if (name === "/2/files/upload_session/finish") {
      const c = store(arg.commit.path); if (c) return c;
      const all = Buffer.concat([...sessions.get(arg.cursor.session_id), body]);
      assert.equal(arg.cursor.offset, all.length - body.length);
      files.set(arg.commit.path, all);
      return json(200, { path_display: arg.commit.path, content_hash: hash(all) });
    }
    if (name === "/2/files/get_metadata") return json(200, { content_hash: hash(files.get(arg.path)) });
    return json(404, {});
  };
  return { files, calls, fetchImpl };
}

async function tempFile(bytes) {
  const f = path.join(await fsp.mkdtemp(path.join(os.tmpdir(), "dbx-")), "f.wav");
  await fsp.writeFile(f, bytes);
  return f;
}

test("the content hash is Dropbox's block hash", async () => {
  const bytes = crypto.randomBytes(9 * 1024 * 1024 + 123);
  const blocks = [0, 1, 2].map((i) => crypto.createHash("sha256").update(bytes.subarray(i * 4194304, (i + 1) * 4194304)).digest());
  assert.equal(await contentHash(await tempFile(bytes)), crypto.createHash("sha256").update(Buffer.concat(blocks)).digest("hex"));
});

test("a small file uploads in one go and is verified", async () => {
  const fake = fakeDropbox();
  const dbx = new Dropbox({ appKey: "k", refreshToken: "r", fetchImpl: fake.fetchImpl, wait: async () => {} });
  const r = await dbx.upload(await tempFile(Buffer.from("hello")), "/vault/a.json");
  assert.ok(r.verified);
  assert.equal(fake.files.get("/vault/a.json").toString(), "hello");
});

test("a large file uploads in pieces, survives a busy server, and is verified", async () => {
  const fake = fakeDropbox({ failFirst: 2 });
  const dbx = new Dropbox({ appKey: "k", refreshToken: "r", fetchImpl: fake.fetchImpl, wait: async () => {} });
  const bytes = crypto.randomBytes(160 * 1024 * 1024 + 7); // over the one-request limit
  const progress = [];
  const r = await dbx.upload(await tempFile(bytes), "/vault/master.wav", { onProgress: (done, total) => progress.push(done / total) });
  assert.ok(r.verified);
  assert.ok(fake.files.get("/vault/master.wav").equals(bytes));
  assert.ok(fake.calls.includes("/2/files/upload_session/append_v2"));
  assert.equal(progress.at(-1), 1);
});

test("an upload that's already there is fine if identical, refused if different", async () => {
  const fake = fakeDropbox();
  const dbx = new Dropbox({ appKey: "k", refreshToken: "r", fetchImpl: fake.fetchImpl, wait: async () => {} });
  const f = await tempFile(Buffer.from("same"));
  await dbx.upload(f, "/vault/x.json");
  assert.ok((await dbx.upload(f, "/vault/x.json")).alreadyThere);
  await assert.rejects(dbx.upload(await tempFile(Buffer.from("different")), "/vault/x.json"), /different contents. Nothing was overwritten/);
});

test("sign-in uses PKCE with no secret, the app's narrow scopes, and the local return address", () => {
  const { url, verifier } = startAuthorization("appkey123");
  const u = new URL(url);
  assert.equal(u.searchParams.get("client_id"), "appkey123");
  assert.equal(u.searchParams.get("code_challenge_method"), "S256");
  assert.equal(u.searchParams.get("code_challenge"), crypto.createHash("sha256").update(verifier).digest("base64url"));
  assert.equal(u.searchParams.get("token_access_type"), "offline");
  assert.equal(u.searchParams.get("redirect_uri"), REDIRECT_URI);
  assert.equal(u.searchParams.get("scope"), "account_info.read files.metadata.read files.content.write");
});

test("disconnecting cancels the sign-in at Dropbox", async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url.replace(/^https:\/\/[^/]+/, ""));
    return { ok: true, status: 200, json: async () => (url.endsWith("/oauth2/token") ? { access_token: "A", expires_in: 3600 } : null), text: async () => "", headers: { get: () => null } };
  };
  await new Dropbox({ appKey: "k", refreshToken: "r", fetchImpl }).revoke();
  assert.deepEqual(calls, ["/oauth2/token", "/2/auth/token/revoke"]);
});
