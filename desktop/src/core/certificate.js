// A one-page paper certificate for a sealed capsule. Paper outlives servers: it records,
// outside the capsule, whose keys sealed it and the fingerprint of what they signed, so
// a reader decades from now can tell a genuine capsule from one signed with other keys.
// Nothing on it is secret.

import { fingerprint } from "./keys.js";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const groups = (hex, n = 4) => String(hex).toUpperCase().match(new RegExp(`.{1,${n}}`, "g")).join(" ");

export function certificateHtml(receipt, { fellowName, historianName } = {}) {
  const sig = (role) => receipt.signatures?.find((s) => s.role === role) || {};
  const f = sig("fellow"), h = sig("historian");
  const ts = receipt.timestamp || {};
  const when = new Date(receipt.sealedAt).toLocaleString("en-US", { dateStyle: "long", timeStyle: "short" });
  return `<!doctype html><html><head><meta charset="utf-8"><title>Sondage certificate</title>
<style>
  @page { size: letter; margin: 0.8in; }
  body { font: 13pt/1.45 Georgia, "Times New Roman", serif; color: #1d1b17; background: #fff; max-width: 6.9in; margin: 0 auto; }
  h1 { font-size: 22pt; font-weight: normal; margin: 0 0 4pt; }
  .lede { color: #555; margin: 0 0 18pt; }
  dl { display: grid; grid-template-columns: 2.1in 1fr; gap: 6pt 12pt; margin: 0 0 18pt; }
  dt { color: #555; }
  dd { margin: 0; }
  .mono { font: 12pt/1.4 "Courier New", monospace; letter-spacing: 0.02em; word-break: break-all; }
  .fp { font: bold 15pt "Courier New", monospace; letter-spacing: 0.06em; }
  h2 { font-size: 13pt; margin: 18pt 0 6pt; }
  p.small, li { font-size: 11pt; color: #333; }
</style></head><body>
<h1>Sondage recording certificate</h1>
<p class="lede">Keep this page with your papers. It shows that the recording below is genuine.</p>
<dl>
  <dt>Recording</dt><dd>${esc(receipt.session?.title || "Interview")}</dd>
  <dt>Sealed</dt><dd>${esc(when)}</dd>
  <dt>Senior Fellow</dt><dd>${esc(fellowName || f.name || "")}</dd>
  <dt>Fellow's key</dt><dd class="fp">${f.publicKey ? esc(fingerprint(f.publicKey)) : "—"}</dd>
  <dt>Historian</dt><dd>${esc(historianName || h.name || "")}</dd>
  <dt>Historian's key</dt><dd class="fp">${h.publicKey ? esc(fingerprint(h.publicKey)) : "—"}</dd>
  <dt>Capsule</dt><dd class="mono">${esc(receipt.capsuleId)}</dd>
  <dt>Manifest fingerprint</dt><dd class="mono">${esc(groups(receipt.manifestSha256))}</dd>
  <dt>Time certified</dt><dd>${ts.status === "granted" ? `Yes, by ${esc(ts.url)} at ${esc(ts.genTime)}` : "No"}</dd>
</dl>
<h2>How to use this page</h2>
<ol>
  <li>The recording is a file ending in <span class="mono">.capsule.age</span>. Only the Fellow's key, or an heir's, can open it.</li>
  <li>Inside, <span class="mono">VERIFY.txt</span> explains how to check it with ordinary tools, without Sondage.</li>
  <li>The keys named inside the recording must have the fingerprints printed above, and its manifest must have the fingerprint above. If they don't, it is not this recording.</li>
  <li>With the Sondage verifier: <span class="mono">sondage-verify &lt;file&gt; --identity &lt;key&gt; --fellow-key "${f.publicKey ? esc(fingerprint(f.publicKey)) : ""}"</span></li>
</ol>
<p class="small">Nothing on this page is secret, and it cannot open the recording.</p>
</body></html>`;
}
