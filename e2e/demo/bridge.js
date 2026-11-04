// Stand-in for the Electron preload bridge, with Eleanor's demo data. Demo only.
(() => {
  const day = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d; };
  const iso = (d) => d.toISOString().slice(0, 10);
  const tomorrow5 = day(1); tomorrow5.setHours(5, 0, 0, 0);
  let nextId = 3;
  const entries = [
    { id: 2, body: "I found Luis's old bakery apron in the closet today. It still smells a little like anise. I didn't wash it.", written_on: iso(day(-3)), shared_with_historian: false, era: null, prompt: null, voice: null, versions_count: 0 },
    { id: 1, body: "Mamá sang while she ironed. ==Always the same bolero.== I can still hear it.", written_on: iso(day(-9)), shared_with_historian: true, era: { id: 1, title: "Childhood in Ponce" }, prompt: null, voice: null, versions_count: 1 },
  ];
  const prompts = [{ id: 7, text: "Do you remember the first time you saw snow?", from: "Dr. Samuel Reyes" }];
  const timeline = fetch("/e2e/sample-timeline.json").then((r) => r.json());
  const me = () => ({
    user: { id: 3, name: "Eleanor Ruiz", email: "eleanor@sondage.test", role: "fellow" },
    fellow: { id: 1, name: "Eleanor Ruiz", stage: "interview", signing_public_key: "DEMOKEY", age_recipient: "age1demo",
      safety_contacts: [{ id: 1, name: "Eleanor", role: "self" }, { id: 2, name: "Ana Ruiz", role: "family" }, { id: 3, name: "Marco Ruiz", role: "family" }],
      historian: "Dr. Samuel Reyes", journal_prompts_waiting: prompts.length, next_journal_prompt: prompts[0] ? { text: prompts[0].text, from: prompts[0].from } : null,
      journal_entries_count: entries.length, last_journal_entry: entries[0] && { written_on: entries[0].written_on, body: entries[0].body, voice: false } },
    interviews: [{ id: 9, title: "Life history interview", part: 1, parts: 1, media_type: "video", scheduled_at: tomorrow5.toISOString(), status: "scheduled",
      historian: { name: "Dr. Samuel Reyes", signing_public_key: "H" }, ice_servers: [], relay_only: false }],
  });
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const api = async (method, path, body) => {
    await wait(120);
    if (path === "/api/v1/me") return me();
    if (path === "/api/v1/journal" && method === "GET") return { entries, prompts, eras: [{ id: 1, title: "Childhood in Ponce" }, { id: 2, title: "Coming to New York" }], historian: "Dr. Samuel Reyes" };
    if (path === "/api/v1/journal" && method === "POST") {
      const e = { id: nextId++, body: body.entry.body, written_on: iso(new Date()), shared_with_historian: !!body.entry.shared_with_historian, era: null, prompt: body.entry.journal_prompt_id ? { id: 7, text: prompts[0]?.text } : null, voice: null, versions_count: 0 };
      if (body.entry.journal_prompt_id) prompts.splice(0, 1);
      entries.unshift(e);
      return e;
    }
    if (path === "/api/v1/fellow/timeline") return timeline;
    return {};
  };
  const receipt = { capsuleId: "demo", sealedAt: day(-20).toISOString(), session: { title: "Life history interview, part 1" }, receiptPath: "r", capsulePath: "c", present: true };
  window.sondage = {
    config: { get: async () => ({ signedIn: true, serverUrl: location.origin + "/web/db", vaultDir: "~/Sondage recordings", user: { role: "fellow" } }), set: async () => true, chooseVault: async () => null },
    auth: { signIn: async () => ({}), signOut: async () => true },
    api, apiBytes: async () => new ArrayBuffer(0), cableUrl: async () => "ws://localhost/cable",
    keys: { status: async () => ({ hasKeys: true, signingPublicKey: "DEMOKEY", fingerprint: "1A2B 3C4D 5E6F 7A8B" }), contacts: async () => [], create: async () => ({}), register: async () => ({}), mail: async () => true, restore: async () => ({}), shares: async () => [] },
    recovery: { start: async () => ({}), status: async () => null, cancel: async () => true },
    inherit: { start: async () => ({}), status: async () => null, keys: async () => [] },
    rec: {}, vault: {
      list: async () => [receipt],
      verify: async () => { await wait(1600); return { ok: true, checks: [] }; },
      openCopy: async () => null, reveal: async () => true, listen: async () => ({ tracks: [], title: "" }), certificate: async () => ({}),
    },
  };
})();
