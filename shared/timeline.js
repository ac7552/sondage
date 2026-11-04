// The life timeline: one curved line from birth to today, a coloured stretch per
// chapter. Scrolling moves the camera into each chapter in turn; that chapter's
// photographs, songs, clippings and events fan out along its stretch of the curve.
// Click anything to open it. No libraries; reduced-motion users get a plain list.

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const roman = (n) => ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII", "XIII", "XIV", "XV"][n] || String(n + 1);
const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const ease = (t) => t * t * (3 - 2 * t);
const lerp = (a, b, t) => a + (b - a) * t;

// Mounts the timeline into `el`.
//   data: the TimelineSnapshot shape (fellow, eras, events, items)
//   opts.editable: show edit links (web app only)
//   opts.base: the Fellow's web path, for edit links
//   opts.assetBase: prefix for photo and scan URLs (the desktop app loads them from the web app)
export function mountTimeline(el, data, opts = {}) {
const editable = !!opts.editable;
const base = opts.base || "";
const asset = (u) => (u && opts.assetBase && u.startsWith("/") ? opts.assetBase + u : u);
data = { ...data, items: (data.items || []).map((i) => ({ ...i, image: asset(i.image), fileUrl: asset(i.fileUrl) })) };

// ---------------------------------------------------------------- data

const eras = data.eras.slice().sort((a, b) => a.startYear - b.startYear);
const cards = [
  ...data.events.map((e) => ({ type: "event", ...e })),
  ...data.items.map((i) => ({ type: i.kind, ...i })),
];
// Anything with a year but no chapter goes to the nearest chapter.
for (const c of cards) {
  if (c.eraId || c.year == null || !eras.length) continue;
  const near = eras.reduce((best, e) => (Math.abs(e.startYear - c.year) < Math.abs(best.startYear - c.year) ? e : best), eras[0]);
  c.eraId = near.id;
}
const kindOrder = { photo: 0, event: 1, letter: 2, document: 2, article: 3, song: 4, place: 5 };
const byEra = new Map(eras.map((e) => [e.id, []]));
for (const c of cards) if (byEra.has(c.eraId)) byEra.get(c.eraId).push(c);
for (const list of byEra.values()) list.sort((a, b) => (a.year ?? 9999) - (b.year ?? 9999) || (kindOrder[a.type] ?? 9) - (kindOrder[b.type] ?? 9));

const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches || innerWidth < 760;


// ---------------------------------------------------------------- card faces

function face(c) {
  const ctx = c.source === "context" ? `<span class="ctx" title="Added for context${c.addedBy ? ` by ${esc(c.addedBy)}` : ""}">Context</span>` : "";
  switch (c.type) {
    case "photo":
      return c.image
        ? `<div class="face photo"><img src="${esc(c.image)}" alt="${esc(c.title)}" loading="lazy" draggable="false">${ctx}</div>`
        : `<div class="face photo blank"><span>${esc(c.title)}</span>${ctx}</div>`;
    case "song":
      return `<div class="face song"><div class="disc"></div><div class="sleeve"><span class="s-title">${esc(c.title)}</span><span class="s-by">${esc(c.creator || "")}</span></div>${ctx}</div>`;
    case "article":
      return `<div class="face article"><span class="masthead-mini">${esc(c.publication || "Clipping")}</span><span class="headline">${esc(c.title)}</span><span class="cols"></span>${ctx}</div>`;
    case "letter":
    case "document":
      return c.image
        ? `<div class="face photo doc"><img src="${esc(c.image)}" alt="${esc(c.title)}" loading="lazy" draggable="false">${ctx}</div>`
        : `<div class="face letter"><span class="hand">${esc(c.title)}</span><span class="lines"></span>${ctx}</div>`;
    case "place":
      return `<div class="face place"><span class="pin"></span><span class="p-name">${esc(c.place || c.title)}</span>${ctx}</div>`;
    default:
      return `<div class="face event"><span class="e-year">${esc(c.when || c.year)}</span><span class="e-title">${esc(c.title)}</span></div>`;
  }
}
const SIZE = { photo: [104, 80], song: [86, 86], article: [80, 104], letter: [82, 104], document: [82, 104], place: [96, 74], event: [118, 78] };

// ---------------------------------------------------------------- the curve

function renderCurve() {
  const N = eras.length;
  const SPAN = 300, MARGIN = 150, Y0 = 500, A = 150, H = 1000;
  const W = SPAN * N + MARGIN * 2;
  const nodeX = (i) => MARGIN + SPAN * (i + 0.5);
  const side = (i) => (i % 2 === 0 ? 1 : -1); // +1: node below the midline (like the reference's first stop)
  // A cosine wave: a trough or peak at each chapter's node, crossing the midline between chapters.
  const yAt = (x) => (x < MARGIN || x > MARGIN + SPAN * N ? Y0 : Y0 + A * Math.cos((Math.PI * (x - nodeX(0))) / SPAN));
  const pathBetween = (x1, x2) => {
    let d = "";
    for (let x = x1; x <= x2 + 0.01; x += 4) d += `${d ? "L" : "M"}${x.toFixed(1)} ${yAt(Math.min(x, x2)).toFixed(1)}`;
    return d;
  };
  const tone = (e) => `var(--tone-${e.tone || "ochre"})`;

  // Scroll stops: whole life, each chapter, whole life again.
  const stops = [{ kind: "overview" }, ...eras.map((e, i) => ({ kind: "era", i })), { kind: "overview" }];
  const HOLD = 0.55, MOVE = 0.85; // in viewport heights
  const stopAt = (k) => k * (HOLD + MOVE);

  el.innerHTML = `
    <div class="tl-scroll" style="height:${(stopAt(stops.length - 1) + HOLD + 1) * 100}vh">
      <div class="tl-stage">
        <div class="tl-intro">
          <p class="eyebrow">A life in ${N} chapter${N === 1 ? "" : "s"}</p>
          <h1>${esc(data.fellow.name)}</h1>
          <p class="lede">${esc([data.fellow.birthYear && `Born ${data.fellow.birthYear}`, data.fellow.birthPlace].filter(Boolean).join(" in "))}</p>
          <p class="hint">Scroll to step into each chapter</p>
        </div>
        <div class="tl-world" style="width:${W}px;height:${H}px">
          <svg class="tl-svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" aria-hidden="true">
            <path d="M${MARGIN - 70} ${Y0}H${MARGIN}" class="lead" />
            <path d="M${MARGIN + SPAN * N} ${Y0}H${MARGIN + SPAN * N + 70}" class="lead" />
            ${eras.map((e, i) => `<path d="${pathBetween(MARGIN + SPAN * i, MARGIN + SPAN * (i + 1))}" class="seg" style="stroke:${tone(e)}" />`).join("")}
            ${eras.slice(1).map((e, i) => `<circle cx="${MARGIN + SPAN * (i + 1)}" cy="${Y0}" r="9" class="joint" style="fill:${tone(e)}" />`).join("")}
            ${eras.map((e, i) => {
              const x = nodeX(i), y = Y0 + side(i) * A, ly = Y0 - side(i) * (A + 70);
              return `<g class="pin-g" data-pin="${i}"><line x1="${x}" y1="${y - side(i) * 34}" x2="${x}" y2="${ly}" class="pin" style="stroke:${tone(e)}" /><circle cx="${x}" cy="${ly}" r="3.5" style="fill:${tone(e)}" /></g>`;
            }).join("")}
          </svg>
          <span class="end-label" style="left:${MARGIN - 80}px;top:${Y0 - 34}px">Born</span>
          <span class="end-label" style="left:${MARGIN + SPAN * N + 22}px;top:${Y0 + 14}px">Today</span>
          ${eras.map((e, i) => {
            const x = nodeX(i), y = Y0 + side(i) * A, ly = Y0 - side(i) * (A + 70);
            const up = side(i) > 0; // label above the curve
            return `
              <button class="node" data-era="${i}" style="left:${x}px;top:${y}px;--tone:${tone(e)}" aria-label="${esc(e.title)}"><span>${roman(i)}</span></button>
              <div class="label ${up ? "up" : "down"}" data-label="${i}" style="left:${x}px;top:${ly}px">
                <div class="years">${e.startYear}–${e.endYear ?? "today"}</div>
                <div class="title">${esc(e.title)}</div>
              </div>`;
          }).join("")}
          ${eras.map((e, i) => (byEra.get(e.id) || []).map((c, j) => `<button class="card k-${c.type}" data-era="${i}" data-j="${j}" style="width:${SIZE[c.type][0]}px;height:${SIZE[c.type][1]}px">${face(c)}</button>`).join("")).join("")}
        </div>
        <div class="tl-hud" hidden>
          <p class="eyebrow" id="hud-num"></p>
          <h2 id="hud-title"></h2>
          <p class="years" id="hud-years"></p>
          <p id="hud-summary"></p>
          <p class="small muted" id="hud-count"></p>
          ${editable ? `<p class="small" id="hud-edit"></p>` : ""}
        </div>
        <nav class="tl-rail" aria-label="Chapters">
          <button data-stop="0" title="Whole life">◦</button>
          ${eras.map((e, i) => `<button data-stop="${i + 1}" title="${esc(e.title)}">${roman(i)}</button>`).join("")}
        </nav>
      </div>
    </div>`;

  const world = el.querySelector(".tl-world");
  const stage = el.querySelector(".tl-stage");
  const intro = el.querySelector(".tl-intro");
  const hud = el.querySelector(".tl-hud");
  const cardEls = [...el.querySelectorAll(".card")];
  const labelEls = [...el.querySelectorAll(".label")];
  const nodeEls = [...el.querySelectorAll(".node")];
  const railEls = [...el.querySelectorAll(".tl-rail button")];
  const pinEls = [...el.querySelectorAll(".pin-g")];
  const endEls = [...el.querySelectorAll(".end-label")];

  // Where each card rests when its chapter is open: fanned along the curve like a stack.
  const layout = cardEls.map((cardEl) => {
    const i = +cardEl.dataset.era, j = +cardEl.dataset.j;
    const n = (byEra.get(eras[i].id) || []).length;
    // Spread along this chapter's stretch of the curve, in date order, so the
    // objects themselves become the line — a ribbon of the chapter.
    const u = n === 1 ? 0.5 : 0.06 + (0.88 * j) / (n - 1);
    const x = MARGIN + SPAN * i + SPAN * u;
    const y = yAt(x);
    const angle = Math.atan((yAt(x + 2) - yAt(x - 2)) / 4);
    const wobble = (((j * 37) % 7) - 3) * 0.8; // small and stable, not random
    return { i, j, x, y, rot: (angle * 180) / Math.PI * 0.55 + wobble, nx: nodeX(i), ny: Y0 + side(i) * A };
  });

  let vw = innerWidth, vh = innerHeight;
  const cams = () => {
    const overview = { s: Math.min((vw * 0.9) / W, (vh * 0.58) / 700), cx: W / 2, cy: Y0 - Math.min(160, vh * 0.16) / Math.min((vw * 0.9) / W, (vh * 0.58) / 700) * 0.9 };
    return stops.map((st) => {
      if (st.kind === "overview") return overview;
      const s = Math.min((vw * 0.6) / SPAN, (vh * 0.6) / (A + 120));
      // Leave room on the left for the chapter's heading.
      return { s, cx: nodeX(st.i) - (vw * 0.11) / s, cy: Y0 + side(st.i) * A * 0.5 };
    });
  };
  let camList = cams();

  function frame() {
    const top = el.querySelector(".tl-scroll").getBoundingClientRect().top;
    const sc = Math.max(0, -top) / vh; // in viewport heights
    // Continuous position along the stops, with holds at each.
    let k = 0, t = 0;
    for (let s = 0; s < stops.length - 1; s++) {
      const start = stopAt(s) + HOLD, end = stopAt(s + 1);
      if (sc < start) { k = s; t = 0; break; }
      if (sc < end) { k = s; t = ease((sc - start) / (end - start)); break; }
      k = s + 1; t = 0;
    }
    const a = camList[k], b = camList[Math.min(k + 1, stops.length - 1)];
    // Ease out through a slightly wider view when panning between chapters.
    const dip = stops[k].kind === "era" && stops[k + 1]?.kind === "era" ? 1 - 0.18 * Math.sin(Math.PI * t) : 1;
    const s = lerp(a.s, b.s, t) * dip, cx = lerp(a.cx, b.cx, t), cy = lerp(a.cy, b.cy, t);
    world.style.transform = `translate(${vw / 2 - cx * s}px, ${vh / 2 - cy * s}px) scale(${s})`;

    const pos = k + t; // 0 = overview, i+1 = chapter i
    intro.style.opacity = clamp(1 - pos * 2.5);
    intro.style.transform = `translateY(${-pos * 60}px)`;
    const focus = Math.round(pos) - 1;
    const inEra = focus >= 0 && focus < N && Math.abs(pos - (focus + 1)) < 0.35;
    // Whole-life labels fade as the camera moves in; the chapter heading takes over.
    const wide = clamp(Math.max(1 - pos * 2.2, (pos - N) * 2.2));
    labelEls.forEach((l) => (l.style.opacity = wide));
    pinEls.forEach((g) => (g.style.opacity = wide));
    endEls.forEach((g) => (g.style.opacity = wide));
    nodeEls.forEach((n, i) => {
      n.classList.toggle("on", inEra && i === focus);
      n.style.opacity = Math.max(wide, 1 - clamp(1 - Math.abs(pos - (i + 1)) * 1.7) );
    });
    railEls.forEach((r, i) => r.classList.toggle("on", Math.round(pos) === i || (i === 0 && Math.round(pos) === N + 1)));

    for (let c = 0; c < cardEls.length; c++) {
      const L = layout[c];
      const vis = clamp(1 - Math.abs(pos - (L.i + 1)) * 1.7);
      const v = ease(clamp(vis * 1.5 - L.j * 0.035));
      const elc = cardEls[c];
      if (v <= 0.001) {
        if (elc.style.visibility !== "hidden") elc.style.visibility = "hidden";
        continue;
      }
      elc.style.visibility = "visible";
      const x = lerp(L.nx, L.x, v), y = lerp(L.ny, L.y, v);
      elc.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%) rotate(${L.rot * v}deg) scale(${0.3 + 0.55 * v})`;
      elc.style.opacity = v;
      elc.style.zIndex = 10 + L.j;
    }

    hud.hidden = !inEra;
    if (inEra && hud.dataset.era !== String(focus)) {
      const e = eras[focus];
      hud.dataset.era = focus;
      document.getElementById("hud-num").textContent = `Chapter ${roman(focus)} of ${roman(N - 1)}`;
      document.getElementById("hud-title").textContent = e.title;
      document.getElementById("hud-years").textContent = `${e.startYear}–${e.endYear ?? "today"}`;
      document.getElementById("hud-summary").textContent = e.summary || "";
      const list = byEra.get(e.id) || [];
      const counts = {};
      for (const c of list) counts[c.type] = (counts[c.type] || 0) + 1;
      const words = { photo: "photograph", event: "event", song: "song", article: "article", letter: "letter", document: "document", place: "place" };
      document.getElementById("hud-count").textContent = list.length ? Object.entries(counts).map(([k2, n]) => `${n} ${words[k2] || k2}${n === 1 ? "" : "s"}`).join(" · ") : "Nothing added to this chapter yet.";
      const editEl = document.getElementById("hud-edit");
      if (editEl) editEl.innerHTML = `<a href="${base}/eras/${e.id}/edit">Edit this chapter</a>`;
    }
    hud.style.setProperty("--tone", inEra ? `var(--tone-${eras[focus].tone || "ochre"})` : "transparent");
  }

  let ticking = false;
  const onScroll = () => {
    if (ticking) return;
    if (!shown()) return;
    ticking = true;
    requestAnimationFrame(() => { frame(); ticking = false; });
  };
  addEventListener("scroll", onScroll, { passive: true });
  const shown = () => el.isConnected && el.offsetParent !== null;
  addEventListener("resize", () => { if (!shown()) return; vw = innerWidth; vh = innerHeight; camList = cams(); frame(); });
  frame();

  const scrollToStop = (k) => {
    const st = el.querySelector(".tl-scroll");
    const y = st.getBoundingClientRect().top + scrollY + (stopAt(k) + HOLD * 0.5) * vh;
    scrollTo({ top: y, behavior: "smooth" });
  };
  railEls.forEach((r) => r.addEventListener("click", () => scrollToStop(+r.dataset.stop)));
  nodeEls.forEach((n) => n.addEventListener("click", () => scrollToStop(+n.dataset.era + 1)));
  addEventListener("keydown", (e) => {
    if (!shown() || document.querySelector(".tl-detail")) return;
    if (!["ArrowRight", "ArrowLeft"].includes(e.key)) return;
    const sc = Math.max(0, -el.querySelector(".tl-scroll").getBoundingClientRect().top) / vh;
    const cur = Math.round(sc / (HOLD + MOVE));
    scrollToStop(clamp(cur + (e.key === "ArrowRight" ? 1 : -1), 0, stops.length - 1));
  });
  cardEls.forEach((c) => c.addEventListener("click", () => openDetail(+c.dataset.era, +c.dataset.j)));
}

// ---------------------------------------------------------------- detail

function openDetail(i, j) {
  const list = byEra.get(eras[i].id) || [];
  const c = list[j];
  if (!c) return;
  const close = () => { box.remove(); removeEventListener("keydown", keys); };
  const keys = (e) => {
    if (e.key === "Escape") close();
    if (e.key === "ArrowRight" && j < list.length - 1) { close(); openDetail(i, j + 1); }
    if (e.key === "ArrowLeft" && j > 0) { close(); openDetail(i, j - 1); }
  };
  const kindWord = { photo: "Photograph", event: "Event", song: "Song", article: "Article", letter: "Letter", document: "Document", place: "Place" }[c.type];
  const source = c.type === "event" ? "" : c.source === "context" ? `Added for context${c.addedBy ? ` by ${esc(c.addedBy)}` : ""}` : `From ${esc(data.fellow.name.split(" ")[0])}'s collection`;
  const stageWords = { intake: "at intake", ten_by_ten: "in the 10x10 session", refining: "while refining the profile", after_interview: "after the interview" };
  const visual = c.image
    ? `<img src="${esc(c.image)}" alt="${esc(c.title)}">`
    : `<div class="big-face k-${c.type}">${face(c)}</div>`;
  const moment = c.capsuleMomentSeconds != null ? `<p class="moment">Comes up in the sealed interview at ${new Date(c.capsuleMomentSeconds * 1000).toISOString().slice(11, 19)}</p>` : "";
  const cite = [c.creator, c.publication, c.isrc && `ISRC ${c.isrc}`].filter(Boolean).map(esc).join(" · ");
  const links = [c.url && `<a href="${esc(c.url)}" target="_blank" rel="noopener">${c.type === "song" ? "Listen" : "Open link"}</a>`, c.archiveUrl && `<a href="${esc(c.archiveUrl)}" target="_blank" rel="noopener">Archived copy</a>`, c.fileUrl && !c.image && `<a href="${esc(c.fileUrl)}" target="_blank" rel="noopener">Open the scan</a>`].filter(Boolean).join(" · ");
  const editHref = c.type === "event" ? `${base}/events/${c.id}/edit` : `${base}/items/${c.id}/edit`;

  const box = document.createElement("div");
  box.className = "tl-detail";
  box.setAttribute("role", "dialog");
  box.setAttribute("aria-modal", "true");
  box.innerHTML = `
    <button class="close" aria-label="Close">×</button>
    <article>
      <figure class="visual">${visual}</figure>
      <div class="text">
        <p class="eyebrow">${kindWord}${c.when ? ` · ${esc(c.when)}` : ""}${c.place && c.type !== "place" ? ` · ${esc(c.place)}` : ""}</p>
        <h1>${esc(c.title)}</h1>
        ${cite ? `<p class="cite">${cite}</p>` : ""}
        ${c.story ? `<div class="story">${esc(c.story).replace(/\n/g, "<br>")}</div>` : ""}
        ${c.caption ? `<div class="story">${esc(c.caption).replace(/\n/g, "<br>")}</div>` : ""}
        ${moment}
        ${links ? `<p class="links">${links}</p>` : ""}
        <p class="prov">${[source, c.addedBy && c.type === "event" ? `Added by ${esc(c.addedBy)}` : "", stageWords[c.stageAdded] ? `added ${stageWords[c.stageAdded]}` : ""].filter(Boolean).join(" · ")}</p>
        <p class="nav">
          ${j > 0 ? `<button data-go="-1">← Previous</button>` : ""}
          <span class="muted">${j + 1} of ${list.length} in ${esc(eras[i].title)}</span>
          ${j < list.length - 1 ? `<button data-go="1">Next →</button>` : ""}
          ${editable ? `<a class="edit" href="${editHref}">Edit</a>` : ""}
        </p>
      </div>
    </article>`;
  document.body.appendChild(box);
  box.querySelector(".close").addEventListener("click", close);
  box.addEventListener("click", (e) => { if (e.target === box) close(); });
  box.querySelectorAll("[data-go]").forEach((b) => b.addEventListener("click", () => { close(); openDetail(i, j + +b.dataset.go); }));
  addEventListener("keydown", keys);
  box.querySelector(".close").focus();
}

// ---------------------------------------------------------------- plain list

function renderList() {
  el.innerHTML = `
    <div class="tl-list">
      <p class="eyebrow">A life in ${eras.length} chapters</p>
      <h1>${esc(data.fellow.name)}</h1>
      ${eras.map((e, i) => `
        <section style="--tone:var(--tone-${e.tone || "ochre"})">
          <p class="eyebrow">Chapter ${roman(i)} · ${e.startYear}–${e.endYear ?? "today"}</p>
          <h2>${esc(e.title)}</h2>
          ${e.summary ? `<p class="lede">${esc(e.summary)}</p>` : ""}
          <div class="grid">${(byEra.get(e.id) || []).map((c, j) => `<button class="card k-${c.type}" data-era="${i}" data-j="${j}">${face(c)}<span class="cap">${esc(c.when || "")} ${esc(c.type === "event" ? "" : c.title)}</span></button>`).join("")}</div>
        </section>`).join("")}
    </div>`;
  el.querySelectorAll(".card").forEach((c) => c.addEventListener("click", () => openDetail(+c.dataset.era, +c.dataset.j)));
}


if (!eras.length) {
  el.innerHTML = `<div class="tl-empty"><h1>${esc(data.fellow.name)}</h1><p class="lede">The timeline begins with a first chapter. ${editable ? `<a href="${base}/eras/new">Add the first chapter</a>, or complete the <a href="${base}/intake">intake</a>.` : ""}</p></div>`;
} else if (reduced) {
  renderList();
} else {
  renderCurve();
}
}

// On the web page, mount automatically.
const webEl = typeof document !== "undefined" && document.getElementById("timeline");
const webData = typeof document !== "undefined" && document.getElementById("timeline-data");
if (webEl && webData) mountTimeline(webEl, JSON.parse(webData.textContent), { editable: webEl.dataset.editable === "true", base: webEl.dataset.base });
