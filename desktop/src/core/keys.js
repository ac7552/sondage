// The Fellow's keys. Created on the Fellow's own computer and never sent anywhere.
//   - an Ed25519 signing key: proves the Fellow sealed the capsule
//   - an age (X25519) identity: the only key that can open the capsule
// Public halves are shared with the web app; private halves stay in the OS keychain.

import crypto from "node:crypto";
import { generateX25519Identity, identityToRecipient } from "age-encryption";
import { split, combine } from "shamir-secret-sharing";

export async function generateFellowKeys() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const ageIdentity = await generateX25519Identity();
  const ageRecipient = await identityToRecipient(ageIdentity);
  return {
    version: 1,
    createdAt: new Date().toISOString(),
    signingPrivateKey: privateKey.export({ format: "der", type: "pkcs8" }).toString("base64"),
    signingPublicKey: rawPublicKey(publicKey),
    ageIdentity,
    ageRecipient,
  };
}

export function publicPart(keys) {
  return { signingPublicKey: keys.signingPublicKey, ageRecipient: keys.ageRecipient };
}

function rawPublicKey(keyObject) {
  const jwk = keyObject.export({ format: "jwk" });
  return Buffer.from(jwk.x, "base64url").toString("base64");
}

// Public keys travel as raw 32 bytes in base64 — the same form browsers export.
export function publicKeyFromRaw(rawB64) {
  const raw = Buffer.from(rawB64, "base64");
  if (raw.length !== 32) throw new Error("Ed25519 public key must be 32 bytes");
  return crypto.createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: raw.toString("base64url") }, format: "jwk" });
}

export function sign(keys, bytes) {
  const key = crypto.createPrivateKey({ key: Buffer.from(keys.signingPrivateKey, "base64"), format: "der", type: "pkcs8" });
  return crypto.sign(null, bytes, key).toString("base64");
}

export function verify(publicKeyRawB64, bytes, signatureB64) {
  try {
    return crypto.verify(null, bytes, publicKeyFromRaw(publicKeyRawB64), Buffer.from(signatureB64, "base64"));
  } catch {
    return false;
  }
}

// A short, readable fingerprint people can compare by eye.
export function fingerprint(publicKeyRawB64) {
  const h = crypto.createHash("sha256").update(Buffer.from(publicKeyRawB64, "base64")).digest("hex");
  return h.slice(0, 16).toUpperCase().match(/.{4}/g).join(" ");
}

// Recovery. The two 32-byte secrets (the age X25519 key that opens capsules, and the
// Ed25519 seed that signs them) are split separately, with the same threshold, and each
// safety copy carries one share of each:
//
//   copy = unlockingShare (33 bytes) || signingShare (33 bytes)      — 66 bytes, 132 hex
//
// Any `threshold` copies restore both keys; fewer reveal nothing. Because the halves
// are independent, Sondage can release only the unlocking half of its copy to an heir:
// the heir can then open and listen, and can never rebuild the signing key.
// Copies made by earlier versions (65 bytes: one share of both secrets together) still
// restore, but can't be split this way.
// Shares are printed in groups of four so a person can copy one by hand.

const PKCS8_ED25519_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");
const HALF = 33; // a Shamir share of a 32-byte secret
const LEGACY = 65; // a Shamir share of the 64-byte (seed || x25519) secret

export async function splitForRecovery(keys, { shares = 3, threshold = 2 } = {}) {
  const seed = new Uint8Array(Buffer.from(keys.signingPrivateKey, "base64").subarray(-32));
  const x25519 = new Uint8Array(bech32Decode(keys.ageIdentity, "AGE-SECRET-KEY-"));
  const unlocking = await split(x25519, shares, threshold);
  const signing = await split(seed, shares, threshold);
  return unlocking.map((u, i) => formatShare(i + 1, Buffer.concat([u, signing[i]])));
}

const formatShare = (n, bytes) => `SONDAGE-${n} ` + Buffer.from(bytes).toString("hex").toUpperCase().match(/.{1,4}/g).join(" ");

function parseShares(shareStrings) {
  return shareStrings
    .map((s) => String(s).trim())
    .filter(Boolean)
    .map((s) => {
      // "SONDAGE-2 3809 390C …": the number is a label; the share carries its own position.
      const m = s.match(/^(?:SONDAGE-\d+[\s:]+)?([0-9A-F\s]+)$/i);
      const hex = m ? m[1].replace(/\s+/g, "") : "";
      if (!hex || hex.length % 2) throw new Error("That doesn't look like a Sondage recovery share");
      return Buffer.from(hex, "hex");
    });
}

// Just the unlocking half of a copy: what Sondage releases to an heir.
export function unlockingHalf(shareString) {
  const [p] = parseShares([shareString]);
  if (p.length !== 2 * HALF) throw new Error("This safety copy can't be split (it was made by an earlier version)");
  return p.subarray(0, HALF).toString("hex").toUpperCase();
}

async function combineHalf(parts, which) {
  return Buffer.from(await combine(parts.map((p) => new Uint8Array(p.subarray(which * HALF, (which + 1) * HALF)))));
}

export async function restoreFromShares(shareStrings) {
  const parts = parseShares(shareStrings);
  if (parts.length < 2) throw new Error("Two recovery shares are needed");
  let seed, x25519;
  if (parts.every((p) => p.length === 2 * HALF)) {
    x25519 = await combineHalf(parts, 0);
    seed = await combineHalf(parts, 1);
  } else if (parts.every((p) => p.length === LEGACY)) {
    const secret = Buffer.from(await combine(parts.map((p) => new Uint8Array(p))));
    seed = secret.subarray(0, 32);
    x25519 = secret.subarray(32);
  } else {
    throw new Error("These shares don't belong together");
  }
  if (seed.length !== 32 || x25519.length !== 32) throw new Error("These shares don't belong together");
  const privateKey = crypto.createPrivateKey({ key: Buffer.concat([PKCS8_ED25519_PREFIX, seed]), format: "der", type: "pkcs8" });
  const ageIdentity = bech32Encode("AGE-SECRET-KEY-", x25519);
  return {
    version: 1,
    createdAt: new Date().toISOString(),
    signingPrivateKey: privateKey.export({ format: "der", type: "pkcs8" }).toString("base64"),
    signingPublicKey: rawPublicKey(crypto.createPublicKey(privateKey)),
    ageIdentity,
    ageRecipient: await identityToRecipient(ageIdentity),
  };
}

// An heir's restore: only the unlocking key is ever rebuilt. Accepts full copies and
// unlocking halves; the signing halves, if present, are never combined.
export async function restoreUnlockingKey(shareStrings) {
  const parts = parseShares(shareStrings);
  if (parts.length < 2) throw new Error("Two recovery shares are needed");
  let x25519;
  if (parts.every((p) => p.length === HALF || p.length === 2 * HALF)) {
    x25519 = await combineHalf(parts, 0);
  } else if (parts.every((p) => p.length === LEGACY)) {
    // Earlier copies hold both secrets together; keep only the unlocking part.
    x25519 = Buffer.from(await combine(parts.map((p) => new Uint8Array(p)))).subarray(32);
  } else {
    throw new Error("These shares don't belong together");
  }
  if (x25519.length !== 32) throw new Error("These shares don't belong together");
  const ageIdentity = bech32Encode("AGE-SECRET-KEY-", x25519);
  return { ageIdentity, ageRecipient: await identityToRecipient(ageIdentity) };
}

// Minimal Bech32 (BIP 173), as used by age for its keys.
const CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
function polymod(values) {
  const G = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  let chk = 1;
  for (const v of values) {
    const top = chk >>> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) if ((top >>> i) & 1) chk ^= G[i];
  }
  return chk >>> 0;
}
const hrpExpand = (hrp) => [...hrp].map((c) => c.charCodeAt(0) >> 5).concat([0], [...hrp].map((c) => c.charCodeAt(0) & 31));
function convertBits(data, from, to, pad) {
  let acc = 0, bits = 0;
  const out = [], max = (1 << to) - 1;
  for (const v of data) {
    acc = (acc << from) | v;
    bits += from;
    while (bits >= to) { bits -= to; out.push((acc >> bits) & max); }
  }
  if (pad && bits > 0) out.push((acc << (to - bits)) & max);
  else if (!pad && (bits >= from || ((acc << (to - bits)) & max))) throw new Error("Invalid key padding");
  return out;
}
function bech32Encode(prefix, bytes) {
  const hrp = prefix.toLowerCase(); // age's identities use "age-secret-key-"
  const data = convertBits(bytes, 8, 5, true);
  const mod = polymod(hrpExpand(hrp).concat(data, [0, 0, 0, 0, 0, 0])) ^ 1;
  const checksum = [0, 1, 2, 3, 4, 5].map((i) => (mod >> (5 * (5 - i))) & 31);
  return (hrp + "1" + data.concat(checksum).map((d) => CHARSET[d]).join("")).toUpperCase();
}
function bech32Decode(str, prefix) {
  const s = str.toLowerCase();
  const sep = s.lastIndexOf("1");
  const hrp = s.slice(0, sep);
  if (hrp !== prefix.toLowerCase()) throw new Error("Unexpected key type");
  const data = [...s.slice(sep + 1)].map((c) => CHARSET.indexOf(c));
  if (data.includes(-1) || polymod(hrpExpand(hrp).concat(data)) !== 1) throw new Error("Invalid key checksum");
  return Buffer.from(convertBits(data.slice(0, -6), 5, 8, false));
}
