import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * `resolve.py` carries the Snowball Seed Scout harvest logic — target
 * resolution, post-URL filtering, and the copy-link eval scripts — and ships its
 * own unittest suite. That suite is worthless if nothing runs it, so drive it
 * from the Node test run that CI already gates on.
 */
const RESOLVE_SCRIPT = join(
  process.cwd(),
  "scripts",
  "snowball-seed-scout",
  "lib",
  "resolve.py",
);

describe("snowball seed scout resolve.py", () => {
  it("passes its bundled self-test suite", () => {
    const result = spawnSync("python3", [RESOLVE_SCRIPT, "self-test"], {
      encoding: "utf8",
    });

    if (result.error) {
      throw new Error(
        `Failed to run python3 for resolve.py self-test: ${result.error.message}`,
      );
    }

    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
    expect(output, output).toContain("OK");
    expect(result.status, output).toBe(0);
  });

  it("rejects navigation URLs as Snowball seeds", () => {
    const result = spawnSync(
      "python3",
      [
        RESOLVE_SCRIPT,
        "fallback",
        JSON.stringify({ communities: ["https://x.com/home"], searchQueries: [] }),
        "x",
        "5",
      ],
      { encoding: "utf8" },
    );

    expect(result.status, result.stderr).toBe(0);
    // A feed/navigation page is not a post; queueing it would hand Network
    // Snowball a seed with no author to expand.
    expect(result.stdout.trim()).toBe("");
  });
});
