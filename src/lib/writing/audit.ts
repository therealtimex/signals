import type { ApprovalState, EvidenceSpine, VariantWriting, WritingAudit } from "@/lib/writing/contracts";

const blockerClasses = new Set(["hard", "claim"]);
const voiceSkippableClasses = new Set(["voice", "heuristic", "aesthetic"]);

function applies(finding: WritingAudit["findings"][number]): boolean {
  return !finding.skippedForVoice || !voiceSkippableClasses.has(finding.class);
}

export function deriveAuditVerdict(
  audit: Pick<WritingAudit, "findings" | "claims"> & Partial<Pick<WritingAudit, "hard" | "voice">>,
  spine?: EvidenceSpine,
): WritingAudit["verdict"] {
  const claimById = new Map(spine?.claims.map((claim) => [claim.id, claim]));
  const blocker = audit.findings.some((finding) => finding.severity === "blocker" && applies(finding)) ||
    audit.claims.invented.length > 0 ||
    audit.claims.altered.some((id) => claimById.get(id)?.verbatimRequired) ||
    audit.claims.privateIncluded.some((id) => claimById.get(id)?.includeInOutput === false) ||
    Boolean(audit.hard?.chars.some((chars) => chars > audit.hard!.limit));
  if (blocker) return "block";
  return audit.voice?.status === "rules_first" ||
    audit.findings.some((finding) => finding.severity === "warning" && applies(finding)) ||
    audit.claims.missing.length > 0 ||
    audit.claims.altered.length > 0
    ? "warn"
    : "pass";
}

export function validateAuditFindingSemantics(audit: WritingAudit): string | null {
  for (const finding of audit.findings) {
    const segments = finding.code.split("/");
    const encodedClass = segments.at(-2);
    if (encodedClass !== finding.class) return "audit_severity_class";
    if (finding.severity === "blocker" && !blockerClasses.has(finding.class)) return "audit_severity_class";
    if (finding.skippedForVoice && blockerClasses.has(finding.class)) return "audit_voice_skip_class";
  }
  return null;
}

export function deriveRiskTier(audit: WritingAudit, spine: EvidenceSpine, targetKind?: string): ApprovalState["riskTier"] {
  if (audit.verdict === "block" || targetKind === "page" || targetKind === "organization") return "high";
  const used = new Set(audit.claims.privateIncluded);
  if (spine.claims.some((claim) => claim.sensitivity === "private" && (used.has(claim.id) || claim.includeInOutput))) return "high";
  if (spine.claims.some((claim) => (claim.kind === "quote" || claim.kind === "name") && claim.includeInOutput)) return "high";
  return audit.verdict === "warn" ? "medium" : "low";
}

export function hardAuditMatchesWriting(audit: WritingAudit, writing: Pick<VariantWriting, "units" | "media">): boolean {
  return audit.hard.units === writing.units.count &&
    JSON.stringify(audit.hard.chars) === JSON.stringify(writing.units.chars) &&
    audit.hard.mediaCount === (writing.media?.assetIds.length ?? 0);
}
