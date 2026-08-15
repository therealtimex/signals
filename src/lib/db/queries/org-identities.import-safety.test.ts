import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("org identities import safety", () => {
  it("imports on an unmigrated signals data dir without preparing SQL at load", async () => {
    process.env.SIGNALS_DATA_DIR = mkdtempSync(join(tmpdir(), "signals-org-identities-import-"));
    const mod = await import("./org-identities");
    expect(typeof mod.listOrgIdentities).toBe("function");
  });
});
