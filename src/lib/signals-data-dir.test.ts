import { describe, expect, it } from "vitest";
import { resolveHomePrefixedPath, resolveSignalsDataDir } from "@/lib/signals-data-dir";

describe("resolveSignalsDataDir", () => {
  it("does not expand interior tildes in Windows short paths", () => {
    const path = "C:\\Users\\RUNNER~1\\AppData\\Local\\Temp\\signals-data";
    expect(resolveSignalsDataDir(path)).toBe(path);
    expect(resolveHomePrefixedPath(path)).toBe(path);
  });

  it("expands leading ~/ paths", () => {
    expect(resolveHomePrefixedPath("~/signals-data")?.endsWith("/signals-data")).toBe(true);
  });
});
