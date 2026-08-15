import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

describe("getPlatformAdapter factory boundary", () => {
  it("lazy-loads real adapters via loader seam and keeps stub adapters static-only", () => {
    const indexSource = readFileSync(
      fileURLToPath(new URL("./index.ts", import.meta.url)),
      "utf8"
    );
    const loaderSource = readFileSync(
      fileURLToPath(new URL("./real-adapter-loader.ts", import.meta.url)),
      "utf8"
    );

    expect(indexSource).toContain("loadRealAdapter");
    expect(indexSource).not.toMatch(
      /from ["']@\/lib\/platforms\/(x|linkedin|gmail)\/adapter["']/
    );
    expect(indexSource).toMatch(
      /from ["']@\/lib\/platforms\/(instagram|facebook|threads)\/adapter["']/
    );

    expect(loaderSource).toContain("require(\"@/lib/platforms/x/adapter\")");
    expect(loaderSource).toContain("require(\"@/lib/platforms/linkedin/adapter\")");
    expect(loaderSource).toContain("require(\"@/lib/platforms/gmail/adapter\")");
    expect(loaderSource).not.toMatch(
      /from ["']@\/lib\/platforms\/(x|linkedin|gmail)\/adapter["']/
    );
  });
});
