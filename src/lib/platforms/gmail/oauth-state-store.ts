/**
 * File-persisted OAuth state store for Google OAuth 2.0 flows.
 * Stores CSRF state strings with 10-min TTL.
 * Same pattern as LinkedIn's oauth-state-store.
 */

import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";

interface StateEntry {
  createdAt: number; // unix ms
}

const TTL_MS = 10 * 60 * 1000; // 10 minutes
const dataDir = process.env.SIGNALS_DATA_DIR?.replace("~", homedir()) ?? join(homedir(), ".signals");
const STATE_FILE = join(dataDir, "gmail-oauth-state.json");

/** Read store from disk, returning empty object on any failure. */
function readStore(): Record<string, StateEntry> {
  try {
    const raw = readFileSync(STATE_FILE, "utf-8");
    return JSON.parse(raw) as Record<string, StateEntry>;
  } catch {
    return {};
  }
}

/** Write store to disk. */
function writeStore(store: Record<string, StateEntry>): void {
  try {
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(STATE_FILE, JSON.stringify(store), "utf-8");
  } catch {
    // Best-effort — if disk write fails, OAuth will fail with invalid_state
  }
}

/** Remove entries older than TTL. */
function cleanExpiredStates(store: Record<string, StateEntry>): Record<string, StateEntry> {
  const now = Date.now();
  const cleaned: Record<string, StateEntry> = {};
  for (const [key, entry] of Object.entries(store)) {
    if (now - entry.createdAt <= TTL_MS) {
      cleaned[key] = entry;
    }
  }
  return cleaned;
}

/** Save a CSRF state string for later validation. */
export function saveGmailOAuthState(state: string): void {
  const store = cleanExpiredStates(readStore());
  store[state] = { createdAt: Date.now() };
  writeStore(store);
}

/** Retrieve and consume a state entry. Returns true if valid, false if expired/missing. */
export function validateGmailOAuthState(state: string): boolean {
  const store = cleanExpiredStates(readStore());
  const entry = store[state];
  if (!entry) return false;
  delete store[state]; // single-use
  writeStore(store);
  return true;
}
