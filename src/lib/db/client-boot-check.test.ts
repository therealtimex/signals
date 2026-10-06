import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

// Drives the real module load of src/lib/db/client.ts (the boot path), not the helper alone.
// HOME is a throwaway directory, so "~/.signals" here is never the owner's real data.
describe("db client boot check (ADR-541-5)", () => {
  let home = "";

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
    if (home) rmSync(home, { recursive: true, force: true });
  });

  it("refuses to open ~/.signals in a dev instance, before creating or opening anything", async () => {
    home = mkdtempSync(join(tmpdir(), "signals-boot-home-"));
    vi.stubEnv("HOME", home);
    vi.stubEnv("USERPROFILE", home);
    vi.stubEnv("SIGNALS_INSTANCE", "dev");
    vi.stubEnv("SIGNALS_DATA_DIR", "~/.signals");
    vi.resetModules();

    // Reduce the outcome to a string or the error: a resolved module namespace is too large for
    // the matcher to print if the check ever regresses.
    const outcome = await import("@/lib/db/client").then(
      () => "client module loaded",
      (error: unknown) => error,
    );
    expect(outcome).not.toBe("client module loaded");
    expect(outcome).toMatchObject({
      code: "DEV_INSTANCE_DATA_DIR",
      dataDir: join(home, ".signals"),
    });
    expect(existsSync(join(home, ".signals"))).toBe(false);
  });
});
