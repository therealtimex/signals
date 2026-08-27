import { spawnSync } from "node:child_process";
import { join } from "node:path";

export interface SnowballSeedUrlFilterResult {
  accepted: string[];
  rejected: string[];
}

/**
 * Filter harvested URLs through resolve.py so navigation/search/home pages never
 * reach the calendar enqueue path (even if a caller skips scout shell filters).
 */
export function filterSnowballEnqueueUrls(
  urls: string[],
  platformHint?: string | null,
): SnowballSeedUrlFilterResult {
  if (urls.length === 0) {
    return { accepted: [], rejected: [] };
  }

  const script = join(process.cwd(), "scripts/snowball-seed-scout/lib/resolve.py");
  const child = spawnSync(
    "python3",
    [script, "filter-enqueue-json", platformHint?.trim() ?? ""],
    {
      input: urls.join("\n"),
      encoding: "utf8",
    },
  );

  if (child.status !== 0) {
    const detail = `${child.stderr ?? ""}${child.stdout ?? ""}`.trim();
    throw new Error(detail || "filter-enqueue-json failed");
  }

  const parsed = JSON.parse(child.stdout?.trim() || '{"accepted":[],"rejected":[]}') as
    SnowballSeedUrlFilterResult;
  return {
    accepted: Array.isArray(parsed.accepted) ? parsed.accepted : [],
    rejected: Array.isArray(parsed.rejected) ? parsed.rejected : [],
  };
}
