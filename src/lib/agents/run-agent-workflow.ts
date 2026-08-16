import {
  createWorkflowRun,
  createWorkflowStep,
  nextStepIndex,
} from "@/lib/db/queries/workflows";
import { getTemplate } from "@/lib/db/queries/workflow-templates";
import type { AgentRunConfig } from "@/lib/agents/types";
import { DEFAULT_AGENT_MODEL } from "@/lib/agents/types";
import type { WorkflowRun } from "@/lib/db/types";

export const AGENT_ORCHESTRATION_UNAVAILABLE_CODE = "AGENT_ORCHESTRATION_UNAVAILABLE";

export const AGENT_ORCHESTRATION_MESSAGE =
  "In-process agent orchestration was removed from Signals. Run agents via RealTimeX terminal agents and Agent Flows using POST /api/agent-tools/invoke (see docs/rtx-agent-orchestration.md).";

/**
 * Record an agent workflow run as failed immediately.
 * Intelligence now lives in RealTimeX; Signals exposes data/tools via the agent-tools API.
 */
export function startAgentWorkflow(config: AgentRunConfig): WorkflowRun {
  const now = Math.floor(Date.now() / 1000);
  const modelId = config.model ?? DEFAULT_AGENT_MODEL;
  const template = config.templateId ? getTemplate(config.templateId) : null;

  const runConfig = {
    ...config.config,
    ...(template
      ? { templateName: template.name, templateCategory: template.templateType }
      : {}),
  };

  const errorMessage = `${AGENT_ORCHESTRATION_UNAVAILABLE_CODE}: ${AGENT_ORCHESTRATION_MESSAGE}`;

  const run = createWorkflowRun({
    workflowType: config.workflowType,
    templateId: config.templateId,
    status: "failed",
    config: JSON.stringify(runConfig),
    trigger: config.templateId ? "template" : "user",
    model: modelId,
    startedAt: now,
    completedAt: now,
    errors: JSON.stringify([errorMessage]),
    errorItems: 1,
  });

  createWorkflowStep({
    workflowRunId: run.id,
    stepIndex: nextStepIndex(run.id),
    stepType: "error",
    status: "failed",
    tool: "agent_runner",
    error: AGENT_ORCHESTRATION_MESSAGE,
    durationMs: 0,
  });

  return run;
}
