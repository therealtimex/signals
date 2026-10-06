import { realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve, sep } from "node:path";
import { getInstanceKind, type InstanceEnv } from "@/lib/instance/instance";
import { resolveSignalsDataDir } from "@/lib/signals-data-dir";

export const DEV_INSTANCE_DATA_DIR = "DEV_INSTANCE_DATA_DIR" as const;

export class DevInstanceDataDirError extends Error {
  readonly code = DEV_INSTANCE_DATA_DIR;

  constructor(
    readonly dataDir: string,
    readonly canonicalDataDir: string,
  ) {
    super(
      `Refusing to open ${dataDir}: this Signals instance is a Dev app (SIGNALS_INSTANCE=dev) ` +
        `and that directory is the canonical Signals data (${canonicalDataDir}). ` +
        `Point SIGNALS_DATA_DIR at a disposable directory such as ~/.signals-dev/<slot>.`,
    );
    this.name = "DevInstanceDataDirError";
  }
}

/** Absolute data directory this process uses: `SIGNALS_DATA_DIR`, else `~/.signals`. */
export function resolveInstanceDataDir(env: InstanceEnv = process.env): string {
  // `?? ""`, not `undefined`: an explicit undefined would make the resolver fall back to
  // process.env and ignore the injected env.
  return resolve(resolveSignalsDataDir(env.SIGNALS_DATA_DIR ?? ""));
}

/** The canonical Signals data directory, `$HOME/.signals`. */
export function canonicalSignalsDataDir(): string {
  return join(homedir(), ".signals");
}

/** Real path of `path`; a missing tail is appended to the real path of its deepest existing ancestor. */
function realPathAllowMissing(path: string): string {
  const absolute = resolve(path);
  const missing: string[] = [];
  let current = absolute;
  for (;;) {
    try {
      return join(realpathSync.native(current), ...missing);
    } catch {
      const parent = dirname(current);
      if (parent === current) return absolute;
      missing.unshift(basename(current));
      current = parent;
    }
  }
}

function sameDirectoryOnDisk(a: string, b: string): boolean {
  try {
    const left = statSync(a);
    const right = statSync(b);
    return left.dev === right.dev && left.ino === right.ino;
  } catch {
    return false;
  }
}

/**
 * True when `dataDir` is `$HOME/.signals` or lies inside it, after resolving `~`, relative
 * segments, trailing slashes and symlinks. The comparison is case-insensitive on every platform:
 * refusing a case-variant directory on a case-sensitive disk is harmless, missing one on macOS
 * is not.
 */
export function isCanonicalSignalsDataDir(dataDir: string): boolean {
  const canonical = canonicalSignalsDataDir();
  if (sameDirectoryOnDisk(dataDir, canonical)) return true;
  const candidate = realPathAllowMissing(dataDir).toLowerCase();
  const root = realPathAllowMissing(canonical).toLowerCase();
  return candidate === root || candidate.startsWith(root.endsWith(sep) ? root : `${root}${sep}`);
}

/**
 * Boot check (ADR-541-5): a Dev instance must never open the canonical database. Throws
 * `DevInstanceDataDirError` before SQLite is opened; a canonical instance is not checked.
 */
export function assertInstanceDataDir(env: InstanceEnv = process.env): void {
  if (getInstanceKind(env) !== "dev") return;
  const dataDir = resolveInstanceDataDir(env);
  if (isCanonicalSignalsDataDir(dataDir)) {
    throw new DevInstanceDataDirError(dataDir, canonicalSignalsDataDir());
  }
}
