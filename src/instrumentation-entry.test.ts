import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("instrumentation entry", () => {
  it("bootstraps RTX from the root Next.js instrumentation hook", () => {
    const rootPath = join(process.cwd(), "instrumentation.ts");
    const source = readFileSync(rootPath, "utf8");

    expect(source).toContain("bootstrapRtxIfEmbedded");
    expect(existsSync(join(process.cwd(), "src/instrumentation.ts"))).toBe(false);
  });
});
