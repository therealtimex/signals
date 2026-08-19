import {
  createWorkflowStep,
  nextStepIndex,
} from "@/lib/db/queries/workflows";
import { distributePhaseTimings } from "@/lib/workflows/workflow-step-timing";
import type { PipelineContactOutcome } from "@/lib/workflows/pipeline/types";

export type PipelineContactStepStatus = "completed" | "skipped" | "failed";

export function pipelineOutcomeToStepStatus(
  outcome: PipelineContactOutcome,
): PipelineContactStepStatus {
  if (outcome.status === "failed") return "failed";
  if (outcome.status === "skipped") return "skipped";
  return "completed";
}

export type RecordPipelineContactStepInput = {
  workflowRunId: string;
  tool: string;
  outcome: PipelineContactOutcome;
  durationMs: number;
  completedAtMs: number;
};

export function recordPipelineContactStep(input: RecordPipelineContactStepInput): void {
  createWorkflowStep({
    workflowRunId: input.workflowRunId,
    stepIndex: nextStepIndex(input.workflowRunId),
    stepType: "tool_call",
    status: pipelineOutcomeToStepStatus(input.outcome),
    tool: input.tool,
    contactId: input.outcome.contactId,
    input: JSON.stringify({ contactId: input.outcome.contactId }),
    output: JSON.stringify(input.outcome),
    error: input.outcome.status === "failed" ? input.outcome.reason : undefined,
    durationMs: input.durationMs,
    createdAt: Math.floor(input.completedAtMs / 1000),
  });
}

export function recordDistributedPipelineContactSteps(input: {
  workflowRunId: string;
  tool: string;
  outcomes: PipelineContactOutcome[];
  phaseStartedAtMs: number;
  phaseEndedAtMs: number;
}): void {
  const timings = distributePhaseTimings(
    input.outcomes.length,
    input.phaseStartedAtMs,
    input.phaseEndedAtMs,
  );

  input.outcomes.forEach((outcome, index) => {
    const timing = timings[index];
    if (!timing) return;
    recordPipelineContactStep({
      workflowRunId: input.workflowRunId,
      tool: input.tool,
      outcome,
      durationMs: timing.durationMs,
      completedAtMs: timing.completedAtMs,
    });
  });
}
