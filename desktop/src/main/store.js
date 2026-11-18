// Local settings and secrets for the desktop app.
// Secrets (the sign-in token and the Fellow's private keys) are encrypted with
// the operating system's keychain via Electron safeStorage.

import fs from "node:fs";
import path from "node:path";
import { app, safeStorage } from "electron";

const dir = () => app.getPath("userData");
const file = (name) => path.join(dir(), name);

export function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(file("config.json"), "utf8"));
  } catch {
    return {};
  }
}

export function writeConfig(patch) {
  const next = { ...readConfig(), ...patch };
  fs.mkdirSync(dir(), { recursive: true });
  fs.writeFileSync(file("config.json"), JSON.stringify(next, null, 2));
  return next;
}

// A downloaded app signs in to the address it was built for (package.json
// "sondageServerUrl", set by the release build); development uses localhost.
function builtInServerUrl() {
  try {
    return JSON.parse(fs.readFileSync(path.join(app.getAppPath(), "package.json"), "utf8")).sondageServerUrl || null;
  } catch {
    return null;
  }
}

export function defaults() {
  return {
    serverUrl: process.env.SONDAGE_SERVER_URL || builtInServerUrl() || "http://localhost:3000",
    vaultDir: process.env.SONDAGE_VAULT_DIR || path.join(app.getPath("documents"), "Sondage Vault"),
    // Where each Sitting is filed on this computer (Stephen's layout starts at vault/).
    archiveDir: process.env.SONDAGE_ARCHIVE_DIR || path.join(app.getPath("desktop"), "vault"),
    tsaUrl: process.env.SONDAGE_TSA_URL ?? "https://freetsa.org/tsr",
  };
}

export function config() {
  return { ...defaults(), ...readConfig() };
}

export function keychainAvailable() {
  return safeStorage.isEncryptionAvailable();
}

export function writeSecret(name, value) {
  fs.mkdirSync(dir(), { recursive: true });
  const text = JSON.stringify(value);
  if (safeStorage.isEncryptionAvailable()) {
    fs.writeFileSync(file(`${name}.secret`), safeStorage.encryptString(text), { mode: 0o600 });
  } else {
    // No OS keychain (some Linux desktops). Kept readable only by this user; the app warns about it.
    fs.writeFileSync(file(`${name}.plain`), text, { mode: 0o600 });
  }
}

export function readSecret(name) {
  try {
    return JSON.parse(safeStorage.decryptString(fs.readFileSync(file(`${name}.secret`))));
  } catch {}
  try {
    return JSON.parse(fs.readFileSync(file(`${name}.plain`), "utf8"));
  } catch {}
  return null;
}

export function deleteSecret(name) {
  for (const f of [`${name}.secret`, `${name}.plain`]) fs.rmSync(file(f), { force: true });
}

export const stagingRoot = () => path.join(dir(), "staging");
