// The safety-copy page. The piece is in the link's #fragment, which the browser
// never sends to any server. The page sends only a fingerprint to find the request;
// on approval it encrypts the piece to the new computer's one-time key, so only that
// computer can read it.

const $ = (id) => document.getElementById(id);
const root = $("safety");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const hex = location.hash.replace(/^#/, "").replace(/[^0-9a-f]/gi, "").toUpperCase();

function show(title, html, actions) {
  $("s-title").textContent = title;
  $("s-body").innerHTML = html;
  $("s-actions").hidden = !actions;
  if (actions) {
    $("s-yes").textContent = actions.yes;
    $("s-no").textContent = actions.no;
    $("s-yes").onclick = actions.onYes;
    $("s-no").onclick = actions.onNo;
  }
}

async function post(path, body) {
  const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Something went wrong. Please try again, or call Sondage.");
  return data;
}

async function fingerprint() {
  const bytes = new Uint8Array(hex.match(/.{2}/g).map((b) => parseInt(b, 16)));
  const d = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function start() {
  if (!hex || hex.length < 40 || hex.length % 2) {
    return show("Open this page from your email", "<p>This page works from the button in a Sondage safety email. Please open that email and click the button again.</p>");
  }
  const piece_sha256 = await fingerprint();
  let info;
  try {
    info = await post("/safety/lookup", { piece_sha256 });
  } catch (err) {
    return show("This link isn't recognised", `<p>${esc(err.message)}</p>`);
  }
  const fellow = info.fellow.name, first = fellow.split(" ")[0];
  const self = info.contact.role === "self";
  const r = info.recovery;

  if (!r) {
    return show(self ? "Nothing to do right now" : `Thank you for keeping this, ${esc(info.contact.name.split(" ")[0])}`,
      self
        ? "<p>This is your own safety copy. Keep the email. You'll only need it if you ever lose access to your recordings.</p>"
        : `<p>This is your part of ${esc(fellow)}'s safety key. There's nothing to do now. Keep the email: if ${esc(first)} ever loses access to their recordings, Sondage will email you and you'll click the same button.</p>`);
  }
  if (r.already_approved) {
    return show("You've already helped", `<p>Thank you. ${self ? "Your recordings open" : `${esc(first)}'s recordings open`} again as soon as two safety copies are in.</p>`);
  }

  const when = new Date(r.requested_at).toLocaleString(undefined, { weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" });
  show(self ? "Did you ask to get your recordings back?" : `Help ${esc(first)} get their recordings back?`,
    self
      ? `<p>A request was made on <strong>${esc(when)}</strong> to open your recordings on a new computer.</p><p>If that was you, confirm below.</p>`
      : `<p>${esc(fellow)} asked on <strong>${esc(when)}</strong> to open their recordings on a new computer.</p><p><strong>Is this really ${esc(first)}?</strong> If you're not sure, call ${esc(first)} before you answer.</p>`,
    {
      yes: self ? "Yes, this was me" : `Yes, help ${first}`,
      no: self ? "No, I didn't ask" : `No, this wasn't ${first}`,
      onYes: () => approve(piece_sha256, r, self, first),
      onNo: () => deny(piece_sha256, r, self, first),
    });
}

async function approve(piece_sha256, r, self, first) {
  $("s-yes").disabled = $("s-no").disabled = true;
  try {
    const { Encrypter } = await import(root.dataset.ageJs);
    const e = new Encrypter();
    e.addRecipient(r.recipient); // the new computer's one-time key
    const sealed = await e.encrypt(hex);
    const encrypted_piece = btoa(String.fromCharCode(...sealed));
    await post("/safety/approve", { piece_sha256, recovery_id: r.id, encrypted_piece });
    show("Thank you", `<p>${self ? "Your recordings" : `${esc(first)}'s recordings`} open again as soon as one more safety copy comes in. There's nothing else to do.</p>`);
  } catch (err) {
    show("That didn't work", `<p>${esc(err.message)}</p>`);
  }
}

async function deny(piece_sha256, r, self, first) {
  if (!confirm("Stop this request? Sondage will be told straight away.")) return;
  try {
    await post("/safety/deny", { piece_sha256, recovery_id: r.id });
    show("Stopped", `<p>The request is stopped and Sondage has been told. ${self ? "Someone from Sondage will call you." : `Sondage will call ${esc(first)} to check.`}</p>`);
  } catch (err) {
    show("That didn't work", `<p>${esc(err.message)}</p>`);
  }
}

start();
