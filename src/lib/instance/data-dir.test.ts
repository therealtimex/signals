import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  assertInstanceDataDir,
  canonicalSignalsDataDir,
  DevInstanceDataDirError,
  isCanonicalSignalsDataDir,
  resolveInstanceDataDir,
} from "@/lib/instance/data-dir";

// Every case runs against a throwaway $HOME: os.homedir() honours HOME, so the real ~/.signals is
// never stat'ed, let alone opened.
let home = "";

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "signals-instance-home-"));
  vi.stubEnv("HOME", home);
  vi.stubEnv("USERPROFILE", home);
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(home, { recursive: true, force: true });
});

function dev(dataDir?: string) {
  return { SIGNALS_INSTANCE: "dev", ...(dataDir === undefined ? {} : { SIGNALS_DATA_DIR: dataDir }) };
}

describe("resolveInstanceDataDir", () => {
  it("uses the throwaway HOME for this suite", () => {
    expect(homedir()).toBe(home);
    expect(canonicalSignalsDataDir()).toBe(join(home, ".signals"));
  });

  it("defaults to $HOME/.signals and expands a leading ~", () => {
    expect(resolveInstanceDataDir({})).toBe(join(home, ".signals"));
    expect(resolveInstanceDataDir({ SIGNALS_DATA_DIR: "~/.signals-dev/main" })).toBe(
      join(home, ".signals-dev", "main"),
    );
  });

  it("returns an absolute path without a trailing slash", () => {
    expect(resolveInstanceDataDir({ SIGNALS_DATA_DIR: "relative/data/" })).toBe(
      resolve("relative/data"),
    );
  });

  it("ignores process.env when an env is injected", () => {
    vi.stubEnv("SIGNALS_DATA_DIR", "/private/tmp/not-this-one");
    expect(resolveInstanceDataDir({})).toBe(join(home, ".signals"));
  });
});

describe("assertInstanceDataDir", () => {
  it.each([
    ["the absolute path", () => join(home, ".signals")],
    ["a literal ~", () => "~/.signals"],
    ["a trailing slash", () => `${join(home, ".signals")}/`],
    ["a doubled trailing slash", () => `${join(home, ".signals")}//`],
    ["a dot-dot detour", () => join(home, "elsewhere", "..", ".signals")],
    ["a case variant", () => join(home, ".Signals")],
    ["a directory inside it", () => join(home, ".signals", "worker-1")],
  ])("refuses a dev instance pointed at $HOME/.signals via %s", (_label, dataDir) => {
    mkdirSync(join(home, ".signals"), { recursive: true });
    expect(() => assertInstanceDataDir(dev(dataDir()))).toThrow(DevInstanceDataDirError);
  });

  it("refuses a dev instance with no SIGNALS_DATA_DIR (the default is ~/.signals)", () => {
    expect(() => assertInstanceDataDir(dev())).toThrow(DevInstanceDataDirError);
  });

  it("refuses before ~/.signals exists, so a first boot cannot create it", () => {
    expect(() => assertInstanceDataDir(dev(join(home, ".signals")))).toThrow(
      DevInstanceDataDirError,
    );
  });

  it("refuses a symlink that resolves to $HOME/.signals", () => {
    mkdirSync(join(home, ".signals"));
    const link = join(home, "innocent-looking-dir");
    symlinkSync(join(home, ".signals"), link);
    expect(() => assertInstanceDataDir(dev(link))).toThrow(DevInstanceDataDirError);
  });

  it("names both directories and the way out", () => {
    let thrown: unknown;
    try {
      assertInstanceDataDir(dev("~/.signals"));
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toMatchObject({
      code: "DEV_INSTANCE_DATA_DIR",
      dataDir: join(home, ".signals"),
      canonicalDataDir: join(home, ".signals"),
    });
    expect((thrown as Error).message).toContain("SIGNALS_DATA_DIR");
  });

  it.each([
    ["a slot under ~/.signals-dev", () => join(home, ".signals-dev", "loop-issue-541")],
    ["a sibling with a shared prefix", () => join(home, ".signals2")],
    ["a temp dir", () => join(home, "tmp", "signals-541")],
    ["the parent of ~/.signals", () => home],
  ])("allows a dev instance on %s", (_label, dataDir) => {
    mkdirSync(join(home, ".signals"), { recursive: true });
    expect(() => assertInstanceDataDir(dev(dataDir()))).not.toThrow();
  });

  it("does not check a canonical instance, even on $HOME/.signals", () => {
    mkdirSync(join(home, ".signals"));
    expect(() => assertInstanceDataDir({ SIGNALS_DATA_DIR: join(home, ".signals") })).not.toThrow();
    expect(() => assertInstanceDataDir({})).not.toThrow();
  });

  it("reads process.env by default", () => {
    vi.stubEnv("SIGNALS_INSTANCE", "dev");
    vi.stubEnv("SIGNALS_DATA_DIR", "~/.signals");
    expect(() => assertInstanceDataDir()).toThrow(DevInstanceDataDirError);
  });
});

describe("isCanonicalSignalsDataDir", () => {
  it("matches only the canonical directory and its descendants", () => {
    expect(isCanonicalSignalsDataDir(join(home, ".signals"))).toBe(true);
    expect(isCanonicalSignalsDataDir(join(home, ".signals", "media"))).toBe(true);
    expect(isCanonicalSignalsDataDir(join(home, ".signals-dev"))).toBe(false);
    expect(isCanonicalSignalsDataDir(home)).toBe(false);
  });
});
