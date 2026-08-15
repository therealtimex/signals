import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("embeddings import safety", () => {
  it("imports on an unmigrated signals data dir without preparing SQL at load", async () => {
    process.env.SIGNALS_DATA_DIR = mkdtempSync(join(tmpdir(), "signals-import-safety-"));
    const mod = await import("./embeddings");
    expect(typeof mod.semanticSearch).toBe("function");
  });
});
