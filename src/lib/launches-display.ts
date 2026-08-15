import type { LaunchVariantSummary } from "@/lib/db/queries/launches";

export function formatLaunchDate(unix: number | null | undefined): string {
  if (!unix) return "—";
  return new Date(unix * 1000).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function formatVariantCount(variants: LaunchVariantSummary[]): string {
  const n = variants.length;
  const published = variants.filter((v) => v.status === "published").length;
  const base = `${n} variant${n === 1 ? "" : "s"}`;
  return published > 0 ? `${base} · ${published} published` : base;
}

export function sortVariantsForBoard(variants: LaunchVariantSummary[]): LaunchVariantSummary[] {
  return [...variants].sort((a, b) => {
    const aScore = a.predictedScore;
    const bScore = b.predictedScore;
    if (aScore == null && bScore == null) {
      return a.createdAt - b.createdAt;
    }
    if (aScore == null) return 1;
    if (bScore == null) return -1;
    if (bScore !== aScore) return bScore - aScore;
    return a.createdAt - b.createdAt;
  });
}

export function parseAudienceSpec(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}
