import { homedir } from "os";
import { join, resolve } from "path";

/**
 * Refuse to seed demo data into a real CRM.
 *
 * The demo seed writes contacts, content, goals and workflow runs. Run against
 * the default data directory it would interleave fictional people with a real
 * pipeline, and there is no clean way to unpick them afterwards — every row
 * looks like any other row once it is in the graph.
 *
 * So the seed is opt-in by location: `SIGNALS_DATA_DIR` must be set, and must
 * not resolve to the default. This lives apart from `seed-demo.ts` because
 * importing that module imports `@/lib/db/client`, which opens (and migrates)
 * the database on import — the check has to happen strictly before that.
 */
export const DEFAULT_DATA_DIR_NAME = ".signals";

export type DemoSeedGuardVerdict = {
  ok: boolean;
  code: "ready" | "data_dir_unset" | "data_dir_is_default";
  message: string;
  dataDir: string | null;
};

export function defaultSignalsDataDir(home = homedir()): string {
  return join(home, DEFAULT_DATA_DIR_NAME);
}

/**
 * Expand `~` against the *supplied* home rather than the process's.
 *
 * `resolveSignalsDataDir` reads `homedir()` directly, so delegating to it would
 * leave this check partly non-deterministic: `SIGNALS_DATA_DIR=~/.signals` would
 * resolve against the real home even under test. The behaviour is identical in
 * production, where `home` is `homedir()`; the difference is only that the guard
 * can now be proven.
 */
function expandHome(value: string, home: string): string {
  const raw = value.trim();
  if (raw === "~") return home;
  if (raw.startsWith("~/") || raw.startsWith("~\\")) return join(home, raw.slice(2));
  return raw;
}

export function checkDemoSeedTarget(
  env: Partial<Record<string, string | undefined>> = process.env,
  home = homedir(),
): DemoSeedGuardVerdict {
  const raw = env.SIGNALS_DATA_DIR;
  if (!raw?.trim()) {
    return {
      ok: false,
      code: "data_dir_unset",
      message:
        "SIGNALS_DATA_DIR is not set, so this would seed fictional contacts into your real CRM " +
        `at ${defaultSignalsDataDir(home)}. Point it at a throwaway directory, e.g. ` +
        "`SIGNALS_DATA_DIR=/tmp/signals-demo npm run seed:demo`.",
      dataDir: null,
    };
  }

  const dataDir = expandHome(raw, home);
  // Compare resolved absolute paths: `SIGNALS_DATA_DIR=~/.signals` and
  // `SIGNALS_DATA_DIR=$HOME/.signals/` are the same directory as the default,
  // and setting the variable explicitly must not be a way around the check.
  if (resolve(dataDir) === resolve(defaultSignalsDataDir(home))) {
    return {
      ok: false,
      code: "data_dir_is_default",
      message:
        `SIGNALS_DATA_DIR resolves to the default data directory (${resolve(dataDir)}). ` +
        "That is a real CRM, not a demo target. Point it somewhere disposable.",
      dataDir,
    };
  }

  return { ok: true, code: "ready", message: `Seeding demo data into ${dataDir}.`, dataDir };
}
