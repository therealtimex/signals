import { describe, expect, it } from "vitest";
import { checkDemoSeedTarget, defaultSignalsDataDir } from "./demo-seed-guard";

const HOME = "/home/founder";

describe("checkDemoSeedTarget", () => {
  it("refuses to run when SIGNALS_DATA_DIR is unset", () => {
    // The dangerous default: unset means ~/.signals, which is the real CRM.
    const verdict = checkDemoSeedTarget({}, HOME);
    expect(verdict.ok).toBe(false);
    expect(verdict.code).toBe("data_dir_unset");
    expect(verdict.message).toContain("/home/founder/.signals");
    expect(verdict.dataDir).toBeNull();
  });

  it("treats a blank value as unset", () => {
    expect(checkDemoSeedTarget({ SIGNALS_DATA_DIR: "   " }, HOME).code).toBe("data_dir_unset");
  });

  it("refuses when the variable is set but points at the default", () => {
    // Setting the variable must not be a way around the check.
    for (const value of ["/home/founder/.signals", "~/.signals", "/home/founder/.signals/"]) {
      const verdict = checkDemoSeedTarget({ SIGNALS_DATA_DIR: value }, HOME);
      expect(verdict.ok, `expected ${value} to be refused`).toBe(false);
      expect(verdict.code).toBe("data_dir_is_default");
    }
  });

  it("accepts a disposable directory", () => {
    const verdict = checkDemoSeedTarget({ SIGNALS_DATA_DIR: "/tmp/signals-demo" }, HOME);
    expect(verdict.ok).toBe(true);
    expect(verdict.code).toBe("ready");
    expect(verdict.dataDir).toBe("/tmp/signals-demo");
  });

  it("expands a home-relative demo directory", () => {
    const verdict = checkDemoSeedTarget({ SIGNALS_DATA_DIR: "~/signals-demo" }, HOME);
    expect(verdict.ok).toBe(true);
    expect(verdict.dataDir).toBe("/home/founder/signals-demo");
  });

  it("reports the default location it is protecting", () => {
    expect(defaultSignalsDataDir(HOME)).toBe("/home/founder/.signals");
  });
});
