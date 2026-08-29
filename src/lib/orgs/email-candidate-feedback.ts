export function emailCandidateActionSuccessMessage(
  action: "verify" | "invalidate" | "probe" | "correct",
): string {
  const labels: Record<typeof action, string> = {
    verify: "verified",
    invalidate: "invalidated",
    probe: "probe completed",
    correct: "corrected",
  };
  return `Candidate ${labels[action]}.`;
}
