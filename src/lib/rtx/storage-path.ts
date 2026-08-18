import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { EnvLike } from "@/lib/rtx/env";

function resolveDesktopUserDataRoot(env: EnvLike = process.env): string {
  const configured = env.REALTIMEX_USER_DATA_PATH?.trim();
  if (configured) return configured;

  const channel = env.REALTIMEX_RUNTIME_CHANNEL?.trim() || "app";
  return join(homedir(), ".realtimex.ai", "desktop-user-data", channel);
}

function readStorageUserId(env: EnvLike, userDataRoot: string): string | null {
  const fromEnv = env.REALTIMEX_CURRENT_STORAGE_USER?.trim();
  if (fromEnv) return fromEnv;

  const statePath = join(userDataRoot, "state", "current-user.json");
  if (!existsSync(statePath)) return null;

  try {
    const parsed = JSON.parse(readFileSync(statePath, "utf8")) as { userId?: string };
    return parsed.userId?.trim() || null;
  } catch {
    return null;
  }
}

/**
 * Resolve the RealTimeX per-user storage root (directory containing `working-data/`).
 * Mirrors desktop runtime layout when STORAGE_DIR is not injected into Local Apps.
 */
export function resolveRtxStorageDir(env: EnvLike = process.env): string | null {
  const explicit = env.STORAGE_DIR?.trim();
  if (explicit) return explicit;

  const userDataRoot = resolveDesktopUserDataRoot(env);
  const storageUser = readStorageUserId(env, userDataRoot);
  if (!storageUser) return null;

  return join(userDataRoot, "users", storageUser, "storage");
}

export function resolveRtxWorkspaceWorkingDir(
  workspaceSlug: string,
  env: EnvLike = process.env
): string | null {
  const storageDir = resolveRtxStorageDir(env);
  const slug = workspaceSlug.trim();
  if (!storageDir || !slug) return null;
  return join(storageDir, "working-data", slug);
}
