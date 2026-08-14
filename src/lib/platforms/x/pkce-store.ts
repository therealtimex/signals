/**
 * File-persisted PKCE state store for OAuth 2.0 flows.
 * Writes to ~/.signals/pkce-state.json so state survives Turbopack hot reloads.
 * Safe for single-user local app — transient OAuth state only.
 */

import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";

interface PkceEntry {
  codeVerifier: string;
  extended: boolean; // whether extended (Basic+ tier) scopes were requested
  createdAt: number; // unix ms
}

const TTL_MS = 10 * 60 * 1000; // 10 minutes
const dataDir = process.env.SIGNALS_DATA_DIR?.replace("~", homedir()) ?? join(homedir(), ".signals");
const STATE_FILE = join(dataDir, "pkce-state.json");

/** Read store from disk, returning empty object on any failure. */
function readStore(): Record<string, PkceEntry> {
  try {
    const raw = readFileSync(STATE_FILE, "utf-8");
    return JSON.parse(raw) as Record<string, PkceEntry>;
  } catch {
    return {};
  }
}

/** Write store to disk. */
function writeStore(store: Record<string, PkceEntry>): void {
  try {
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(STATE_FILE, JSON.stringify(store), "utf-8");
  } catch {
    // Best-effort — if disk write fails, OAuth will fail with invalid_state
  }
}

/** Remove entries older than TTL. */
function cleanExpiredStates(store: Record<string, PkceEntry>): Record<string, PkceEntry> {
  const now = Date.now();
  const cleaned: Record<string, PkceEntry> = {};
  for (const [key, entry] of Object.entries(store)) {
    if (now - entry.createdAt <= TTL_MS) {
      cleaned[key] = entry;
    }
  }
  return cleaned;
}

/** Save a PKCE code verifier keyed by OAuth state parameter. */
export function savePkceState(state: string, codeVerifier: string, extended = false): void {
  const store = cleanExpiredStates(readStore());
  store[state] = { codeVerifier, extended, createdAt: Date.now() };
  writeStore(store);
}

/** Retrieve and consume a PKCE entry. Returns null if expired or missing. */
export function getPkceState(state: string): { codeVerifier: string; extended: boolean } | null {
  const store = cleanExpiredStates(readStore());
  const entry = store[state];
  if (!entry) return null;
  delete store[state]; // single-use
  writeStore(store);
  return { codeVerifier: entry.codeVerifier, extended: entry.extended };
}
