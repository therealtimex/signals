export type CandidateStatus = "predicted" | "uncertain" | "verified" | "invalid";
export type CandidateEvent =
  | "manual_verify"
  | "agent_verify"
  | "manual_invalidate"
  | "agent_invalidate"
  | "probe_deliverable"
  | "probe_undeliverable"
  | "probe_inconclusive"
  | "mark_uncertain";

export function transitionCandidate(
  status: CandidateStatus,
  event: CandidateEvent,
  options?: { catchAll?: "yes" | "no" | "unknown" },
): { status: CandidateStatus; verificationMethod: string | null; reason?: string } {
  if (event === "manual_verify") return { status: "verified", verificationMethod: "manual" };
  if (event === "agent_verify") return { status: "verified", verificationMethod: "agent" };
  if (event === "manual_invalidate" || event === "agent_invalidate") {
    return { status: "invalid", verificationMethod: event.startsWith("manual") ? "manual" : "agent" };
  }
  if (event === "probe_undeliverable") {
    return { status: "invalid", verificationMethod: "smtp_rcpt" };
  }
  if (event === "probe_deliverable") {
    if (options?.catchAll === "no") return { status: "verified", verificationMethod: "smtp_rcpt" };
    return {
      status: "uncertain",
      verificationMethod: "smtp_rcpt",
      reason: options?.catchAll === "yes" ? "catch_all_domain" : "catch_all_unknown",
    };
  }
  return {
    status: "uncertain",
    verificationMethod: null,
    reason: event === "probe_inconclusive" ? "probe_inconclusive" : undefined,
  };
}
