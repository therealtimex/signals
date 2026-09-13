import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("instrumentation entry", () => {
  // With the app under src/app, `next build` only detects the hook at
  // src/instrumentation.ts. A root-level file still runs under `next dev`, but the
  // build leaves it out of the standalone output, so the shipped runtime never
  // ran it (#484). Keep exactly one hook, and keep it in src/.
  it("bootstraps RTX from the single src/ instrumentation hook", () => {
    const source = readFileSync(join(process.cwd(), "src/instrumentation.ts"), "utf8");

    expect(source).toContain("bootstrapRtxIfEmbedded");
    expect(source).toContain("initWorkflowTerminalCleanupReconciler");
    expect(source.indexOf("initWorkflowTerminalCleanupReconciler")).toBeLessThan(
      source.indexOf("initScheduler"),
    );
    expect(existsSync(join(process.cwd(), "instrumentation.ts"))).toBe(false);
  });
});
