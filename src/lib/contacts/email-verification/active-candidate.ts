import type { contactEmailCandidates } from "@/lib/db/schema";

export type EmailCandidateRow = typeof contactEmailCandidates.$inferSelect;

function parseEvidence(value: string | null): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value ?? "{}");
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

function lifecycleTime(candidate: EmailCandidateRow): number {
  const evidence = parseEvidence(candidate.evidence);
  const history = Array.isArray(evidence.history) ? evidence.history : [];
  const historyTimes = history.flatMap((entry) => (
    typeof entry === "object" && entry !== null && "at" in entry && typeof entry.at === "number"
      ? [entry.at]
      : []
  ));
  return Math.max(
    candidate.updatedAt,
    candidate.createdAt,
    typeof evidence.correctedAt === "number" ? evidence.correctedAt : 0,
    typeof evidence.generatedAt === "number" ? evidence.generatedAt : 0,
    ...historyTimes,
  );
}

function isSuperseded(candidate: EmailCandidateRow): boolean {
  return typeof parseEvidence(candidate.evidence).supersededBy === "string";
}

/** Most recent non-superseded lifecycle wins; id is the stable same-second tie-breaker. */
export function selectActiveEmailCandidate(rows: EmailCandidateRow[]): EmailCandidateRow | undefined {
  return rows.filter((candidate) => !isSuperseded(candidate)).sort((left, right) => (
    lifecycleTime(right) - lifecycleTime(left)
    || right.id.localeCompare(left.id)
  ))[0];
}
