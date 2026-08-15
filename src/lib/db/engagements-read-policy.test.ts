import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC_ROOT = join(process.cwd(), "src");

const ALLOWED_ENGAGEMENT_READ_PATHS = [
  "lib/db/queries/engagements.ts",
  "lib/db/backfills/interactions.ts",
  "lib/db/engagement-interaction-sync.ts",
  "lib/db/engagement-interaction-sync.test.ts",
  "lib/db/backfills/backfills.test.ts",
  "lib/db/engagements-read-policy.test.ts",
  "lib/db/schema.ts",
];

function collectSourceFiles(dir: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectSourceFiles(fullPath));
    } else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
      files.push(fullPath);
    }
  }
  return files;
}

function relativeSrcPath(absPath: string): string {
  return absPath.replace(`${SRC_ROOT}/`, "");
}

describe("engagements read retirement policy", () => {
  it("does not read engagements outside the sync-provenance write path", () => {
    const offenders: string[] = [];

    for (const file of collectSourceFiles(SRC_ROOT)) {
      const rel = relativeSrcPath(file);
      if (ALLOWED_ENGAGEMENT_READ_PATHS.some((allowed) => rel.endsWith(allowed))) {
        continue;
      }
      if (rel.includes("/migrations/")) continue;

      const content = readFileSync(file, "utf8");
      if (content.includes("from(engagements)") || content.includes("FROM engagements")) {
        offenders.push(rel);
      }
    }

    expect(offenders).toEqual([]);
  });
});
