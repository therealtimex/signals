import { readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveInstanceDataDir } from "@/lib/instance/data-dir";
import { getInstanceKind } from "@/lib/instance/instance";
import type { EnvLike } from "@/lib/rtx/env";
import { RTX_SDK_PERMISSIONS } from "@/lib/rtx/manifest";

/**
 * The permissions this Signals instance asks RealTimeX for (#545).
 *
 * The canonical app asks for the whole manifest. A Dev app (`SIGNALS_INSTANCE=dev`) asks only for
 * what its slot needs: the launcher writes `<SIGNALS_DATA_DIR>/.launcher/needs.json` on every `up`.
 * A missing or unreadable file asks for nothing, and names outside the manifest are dropped, so a
 * Dev app can never ask for more than the canonical app does.
 */
export function devNeedsPath(env: EnvLike = process.env): string {
  return join(resolveInstanceDataDir(env), ".launcher", "needs.json");
}

function listedNeeds(raw: string): string[] {
  const parsed: unknown = JSON.parse(raw);
  const needs = (parsed as { needs?: unknown } | null)?.needs;
  return Array.isArray(needs) ? needs.filter((need): need is string => typeof need === "string") : [];
}

export function resolveRequestedRtxPermissions(
  env: EnvLike = process.env,
  readFile: (path: string) => string = (path) => readFileSync(path, "utf8")
): string[] {
  if (getInstanceKind(env) !== "dev") return [...RTX_SDK_PERMISSIONS];
  let needs: string[];
  try {
    needs = listedNeeds(readFile(devNeedsPath(env)));
  } catch {
    return [];
  }
  return RTX_SDK_PERMISSIONS.filter((permission) => needs.includes(permission));
}
