import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PLATFORMS } from "./platforms";

// signals-pp-cli rejects import rows naming a platform outside this registry before it calls
// Signals (#567). It keeps its own copy of the list, so a platform added here must be added there.
const GO_FILE = path.resolve(process.cwd(), "tools/signals-pp-cli/transcendence/import_rows.go");

function goPlatforms(): string[] {
  const source = readFileSync(GO_FILE, "utf8");
  const block = /var signalsPlatforms = \[\]string\{([\s\S]*?)\n\}/.exec(source);
  if (!block) throw new Error(`signalsPlatforms not found in ${GO_FILE}`);
  return [...block[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]);
}

describe("platform registry sync", () => {
  it("signals-pp-cli's import platform list equals PLATFORMS", () => {
    expect(goPlatforms()).toEqual([...PLATFORMS]);
  });
});
