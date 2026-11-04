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

  // After a Fellow's death: an heir can tell Sondage, and later opens the recordings.
  if (!r && info.inheritance) {
    return show(info.inheritance.status === "reported" ? "Sondage is checking" : "Sondage has confirmed it",
      info.inheritance.status === "reported"
        ? `<p>${esc(info.inheritance.reported_by)} told us that ${esc(fellow)} has died. We're very sorry.</p><p>Sondage is checking, and will call the family. Nothing is opened in the meantime.</p>`
        : `<p>We're very sorry for your loss.</p><p>The people ${esc(first)} chose will get an email explaining how to open ${esc(first)}'s recordings.</p>`);
  }
  if (!r && info.can_report_death) {
    return show(`Thank you for keeping this, ${esc(info.contact.name.split(" ")[0])}`,
      `<p>This is your part of ${esc(fellow)}'s safety key. There's nothing to do now.</p>
       <p>${esc(first)} also chose you to receive their recordings after they die. If that has happened, you can tell Sondage here. We will check before anything is opened.</p>`,
      {
        yes: `Tell Sondage that ${first} has died`,
        no: "Not now",
        onYes: () => reportDeath(piece_sha256, first),
        onNo: () => show("Thank you", "<p>Keep this email. You can come back to it any time.</p>"),
      });
  }
  if (r?.inheritance && !r.already_approved) {
    const mine = r.inheritance.mine;
    const when = new Date(r.requested_at).toLocaleString(undefined, { weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" });
    return show(mine ? `Open ${esc(first)}'s recordings on your computer?` : `Help ${esc(r.inheritance.heir.split(" ")[0])} open ${esc(first)}'s recordings?`,
      mine
        ? `<p>On <strong>${esc(when)}</strong>, the Sondage app asked to open ${esc(fellow)}'s recordings on your computer.</p><p>If that was you, confirm below.</p>`
        : `<p>${esc(first)} chose ${esc(r.inheritance.heir)} to receive their recordings. ${esc(r.inheritance.heir.split(" ")[0])} asked on <strong>${esc(when)}</strong> to open them.</p><p>Sondage has confirmed ${esc(first)}'s death, and will call ${esc(r.inheritance.heir.split(" ")[0])} before anything opens. There's nothing you need to do. If something about this seems wrong, you can stop it.</p>`,
      mine
        ? { yes: "Yes, this was me", no: "No, I didn't ask", onYes: () => approve(piece_sha256, r, mine, first), onNo: () => deny(piece_sha256, r, mine, first) }
        : { yes: "That's fine", no: "No, stop this", onYes: () => show("Thank you", "<p>There's nothing else to do.</p>"), onNo: () => deny(piece_sha256, r, mine, first) });
  }

  if (!r) {
    return show(self ? "Nothing to do right now" : `Thank you for keeping this, ${esc(info.contact.name.split(" ")[0])}`,
      self
        ? "<p>This is your own safety copy. Keep the email. You'll only need it if you ever lose access to your recordings.</p>"
        : `<p>This is your part of ${esc(fellow)}'s safety key. There's nothing to do now. Keep the email: if ${esc(first)} ever loses access to their recordings, Sondage will email you and you'll click the same button.</p>`);
  }
  if (r.already_approved) {
    return show("You've already helped", `<p>Thank you. ${self ? "Your recordings open" : `${esc(first)}'s recordings open`} again once Sondage has called ${self ? "you" : esc(first)} to check, and released its own copy.</p>`);
  }

  const when = new Date(r.requested_at).toLocaleString(undefined, { weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" });
  show(self ? "Did you ask to get your recordings back?" : `Help ${esc(first)} get their recordings back?`,
    self
      ? `<p>A request was made on <strong>${esc(when)}</strong> to open your recordings on a new computer.</p><p>If that was you, confirm below.</p>`
      : `<p>${esc(fellow)} asked on <strong>${esc(when)}</strong> to open their recordings on a new computer.</p><p><strong>Is this really ${esc(first)}?</strong> Please call ${esc(first)} on a number you already have before you answer. Don't use a number from an email or message.</p><p>Sondage will also call ${esc(first)} and wait a few days before anything opens.</p>`,
    {
      yes: self ? "Yes, this was me" : `Yes, help ${first}`,
      no: self ? "No, I didn't ask" : `No, this wasn't ${first}`,
      onYes: () => approve(piece_sha256, r, self, first),
      onNo: () => deny(piece_sha256, r, self, first),
    });
}

async function reportDeath(piece_sha256, first) {
  if (!confirm(`Tell Sondage that ${first} has died?\n\nSondage will check with the family before anything is opened.`)) return;
  $("s-yes").disabled = $("s-no").disabled = true;
  try {
    await post("/safety/report_death", { piece_sha256 });
    show("Thank you", `<p>We're very sorry for your loss.</p><p>Sondage will check and call you. When it's confirmed, we'll email you how to open ${esc(first)}'s recordings.</p>`);
  } catch (err) {
    $("s-yes").disabled = $("s-no").disabled = false;
    alert(err.message);
  }
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
    show("Thank you", `<p>${self ? "Your recordings" : `${esc(first)}'s recordings`} open again once Sondage has called ${self ? "you" : esc(first)} to check, and released its own copy. There's nothing else to do.</p>`);
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
