// The only bridge between the window and the main process. No Node access leaks through.
const { contextBridge, ipcRenderer } = require("electron");

const call = async (channel, arg) => {
  const r = await ipcRenderer.invoke(channel, arg);
  if (!r.ok) throw new Error(r.error);
  return r.value;
};

contextBridge.exposeInMainWorld("sondage", {
  config: { get: () => call("config:get"), set: (c) => call("config:set", c), chooseVault: () => call("vault:choose") },
  auth: { signIn: (a) => call("auth:signIn", a), signOut: () => call("auth:signOut") },
  api: (method, path, body) => call("api", { method, path, body }),
  apiBytes: (path) => call("api:bytes", { path }), // e.g. a journal voice note
  cableUrl: () => call("cable:url"),
  keys: {
    status: () => call("keys:status"),
    create: () => call("keys:create"),
    register: (contacts) => call("keys:register", { contacts }),
    contacts: () => call("keys:contacts"),
    mail: (index, fellowName) => call("keys:mail", { index, fellowName }),
    restore: (shares, expectedPublicKey) => call("keys:restore", { shares, expectedPublicKey }),
    shares: () => call("keys:shares"),
  },
  inherit: {
    start: (claimId) => call("inherit:start", { claimId }),
    status: (claimId) => call("inherit:status", { claimId }),
    keys: () => call("keys:inherited"),
  },
  recovery: {
    start: () => call("recovery:start"),
    status: () => call("recovery:status"),
    cancel: () => call("recovery:cancel"),
  },
  rec: {
    open: (sessionId, meta) => call("rec:open", { sessionId, meta }),
    log: (sessionId, actor, action, detail) => call("rec:log", { sessionId, actor, action, detail }),
    track: (sessionId, track) => call("rec:track", { sessionId, track }),
    chunk: (args) => call("rec:chunk", args),
    endTrack: (sessionId, trackId, summary) => call("rec:endTrack", { sessionId, trackId, summary }),
    status: (sessionId) => call("rec:status", { sessionId }),
    discard: (sessionId) => call("rec:discard", { sessionId }),
    manifest: (sessionId, context) => call("rec:manifest", { sessionId, context }),
    seal: (sessionId, historianSignature, historianPublicKey) => call("rec:seal", { sessionId, historianSignature, historianPublicKey }),
  },
  vault: {
    list: () => call("vault:list"),
    verify: (capsulePath, receiptPath) => call("vault:verify", { capsulePath, receiptPath }),
    openCopy: (capsulePath) => call("vault:openCopy", { capsulePath }),
    reveal: (file) => call("vault:reveal", { file }),
    certificate: (receiptPath) => call("vault:certificate", { receiptPath }),
    listen: (capsulePath) => call("vault:listen", { capsulePath }),
  },
});
