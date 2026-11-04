// Sondage hash chain — shared by the desktop app, the historian's browser and the verifier.
// Works anywhere WebCrypto exists (browsers, Electron, Node 20+).
//
// Every recorded chunk is hashed the moment it is written. Each link in the chain
// commits to the previous link, so a missing, reordered or altered chunk breaks
// every link after it.
//
//   genesis   = SHA-256("sondage-capsule:" + sessionId + ":" + trackId)
//   link[i]   = SHA-256(link[i-1] + chunkSha256[i])      (hex strings, ASCII)

const enc = new TextEncoder();

export async function sha256Hex(data) {
  const bytes = typeof data === "string" ? enc.encode(data) : data;
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return toHex(new Uint8Array(digest));
}

export function toHex(bytes) {
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}

export async function genesis(sessionId, trackId) {
  return sha256Hex(`sondage-capsule:${sessionId}:${trackId}`);
}

export async function nextLink(previousLink, chunkSha256) {
  return sha256Hex(previousLink + chunkSha256);
}

// Recomputes a whole chain from a list of chunk hashes. Returns the final link.
export async function chainOf(sessionId, trackId, chunkHashes) {
  let link = await genesis(sessionId, trackId);
  for (const h of chunkHashes) link = await nextLink(link, h);
  return link;
}

export const CHUNK_SECONDS = 10;
export const FORMAT = "sondage-capsule/0.1";
