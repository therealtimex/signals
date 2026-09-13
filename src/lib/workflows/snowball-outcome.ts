import type { WorkflowRun } from "@/lib/db/types";
import { isNetworkSnowballTemplateConfig } from "@/lib/workflows/network-snowball";

type WorkflowOutcomeRun = Pick<
  WorkflowRun,
  "config" | "result" | "successItems" | "errorItems"
>;

export type WorkflowOutcomeMetrics = {
  successValue: number;
  errorValue: number;
  successLabel: "Success" | "Committed";
  errorLabel: "Errors" | "Audit violations";
  isSnowball: boolean;
};

function parseObject(value: string | null): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value ?? "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function nonNegativeInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : null;
}

export function getWorkflowOutcomeMetrics(run: WorkflowOutcomeRun): WorkflowOutcomeMetrics {
  const config = parseObject(run.config);
  if (!isNetworkSnowballTemplateConfig(config)) {
    return {
      successValue: run.successItems,
      errorValue: run.errorItems,
      successLabel: "Success",
      errorLabel: "Errors",
      isSnowball: false,
    };
  }

  const result = parseObject(run.result);
  const snowballCandidates = result.snowballCandidates &&
    typeof result.snowballCandidates === "object" &&
    !Array.isArray(result.snowballCandidates)
    ? result.snowballCandidates as Record<string, unknown>
    : {};
  const identityEvidenceAudit = result.identityEvidenceAudit &&
    typeof result.identityEvidenceAudit === "object" &&
    !Array.isArray(result.identityEvidenceAudit)
    ? result.identityEvidenceAudit as Record<string, unknown>
    : {};
  const violationDetails = identityEvidenceAudit.violations;
  const hasViolationDetails = Array.isArray(violationDetails);
  const violations = hasViolationDetails
    ? violationDetails.filter((value) => typeof value === "string")
    : [];

  return {
    successValue: nonNegativeInteger(snowballCandidates.committed) ?? run.successItems,
    errorValue:
      nonNegativeInteger(identityEvidenceAudit.violationCount) ??
      (hasViolationDetails ? violations.length : run.errorItems),
    successLabel: "Committed",
    errorLabel: "Audit violations",
    isSnowball: true,
  };
}
