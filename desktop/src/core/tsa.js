// RFC 3161 trusted timestamps. Only the manifest's SHA-256 leaves the computer.
// The response (timestamp.tsr) can be checked independently with:
//   openssl ts -verify -digest <manifest sha256> -in timestamp.tsr -CAfile <tsa cacert>

import crypto from "node:crypto";

export const DEFAULT_TSA_URL = "https://freetsa.org/tsr";

function len(n) {
  if (n < 0x80) return Buffer.from([n]);
  const bytes = [];
  while (n > 0) {
    bytes.unshift(n & 0xff);
    n >>= 8;
  }
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}
const tlv = (tag, body) => Buffer.concat([Buffer.from([tag]), len(body.length), body]);
const seq = (...items) => tlv(0x30, Buffer.concat(items));
function int(buf) {
  let b = Buffer.from(buf);
  if (b[0] & 0x80) b = Buffer.concat([Buffer.from([0]), b]);
  return tlv(0x02, b);
}
const SHA256_OID = Buffer.from([0x06, 0x09, 0x60, 0x86, 0x48, 0x01, 0x65, 0x03, 0x04, 0x02, 0x01]);
const NULL = Buffer.from([0x05, 0x00]);
const TRUE = Buffer.from([0x01, 0x01, 0xff]);

export function buildTimeStampQuery(sha256Hex, nonce = crypto.randomBytes(8)) {
  return seq(
    int(Buffer.from([1])), // version
    seq(seq(SHA256_OID, NULL), tlv(0x04, Buffer.from(sha256Hex, "hex"))), // messageImprint
    int(nonce),
    TRUE // certReq: include the TSA certificate in the response
  );
}

export async function requestTimestamp(sha256Hex, url = DEFAULT_TSA_URL, { timeoutMs = 15000 } = {}) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/timestamp-query" },
    body: buildTimeStampQuery(sha256Hex),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`Timestamp authority answered ${res.status}`);
  const tsr = Buffer.from(await res.arrayBuffer());
  const info = inspectTimestampResponse(tsr, sha256Hex);
  if (!info.granted) throw new Error(`Timestamp authority refused the request (status ${info.status})`);
  if (!info.coversHash) throw new Error("Timestamp response does not cover the manifest hash");
  return { tsr, ...info, url };
}

// A light structural check; full certificate validation is left to openssl.
export function inspectTimestampResponse(tsr, sha256Hex) {
  // TimeStampResp ::= SEQUENCE { status PKIStatusInfo, timeStampToken OPTIONAL }
  let off = 0;
  const readHeader = () => {
    const tag = tsr[off++];
    let l = tsr[off++];
    if (l & 0x80) {
      const n = l & 0x7f;
      l = 0;
      for (let i = 0; i < n; i++) l = (l << 8) | tsr[off++];
    }
    return { tag, l };
  };
  readHeader(); // outer SEQUENCE
  readHeader(); // PKIStatusInfo SEQUENCE
  const s = readHeader(); // INTEGER status
  const status = s.tag === 0x02 ? tsr[off] : -1;
  const coversHash = tsr.includes(Buffer.from(sha256Hex, "hex"));
  // genTime is the first GeneralizedTime (tag 0x18) in the token.
  let genTime = null;
  for (let i = 0; i < tsr.length - 17; i++) {
    if (tsr[i] === 0x18 && tsr[i + 1] >= 15 && tsr[i + 1] <= 23) {
      const t = tsr.toString("ascii", i + 2, i + 2 + tsr[i + 1]);
      const m = t.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\.\d+)?Z$/);
      if (m) {
        genTime = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}${m[7] || ""}Z`;
        break;
      }
    }
  }
  return { status, granted: status === 0 || status === 1, coversHash, genTime };
}
