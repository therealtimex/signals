import { homedir } from "os";
import { join } from "path";

/** Resolve a path that may start with ~ without touching interior ~ (Windows short paths). */
export function resolveHomePrefixedPath(value?: string | null): string | undefined {
  if (!value?.trim()) return undefined;
  const raw = value.trim();
  if (raw === "~") return homedir();
  if (raw.startsWith("~/") || raw.startsWith("~\\")) {
    return join(homedir(), raw.slice(2));
  }
  return raw;
}

/** Resolve SIGNALS_DATA_DIR without corrupting Windows short paths (e.g. RUNNER~1). */
export function resolveSignalsDataDir(envValue = process.env.SIGNALS_DATA_DIR): string {
  return resolveHomePrefixedPath(envValue) ?? join(homedir(), ".signals");
}
