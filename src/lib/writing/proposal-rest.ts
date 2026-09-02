import { z } from "zod";
import { AgentToolError } from "@/lib/agent-tools/types";
import { getWorkflowRun } from "@/lib/db/queries/workflows";
import {
  findWorkflowRunIdForProposal,
  getWorkflowRunProposal,
} from "@/lib/writing/workflow-run-proposals";

const dashboardRouteSchema = z.string().regex(
  /^\/dashboard\/(workflows|launches)\/[A-Za-z0-9_-]+(?:\/.*)?$/,
  "route must point to a workflow or launch page",
);

export const proposalDecisionBodySchema = z.object({
  route: dashboardRouteSchema,
  note: z.string().trim().max(2_000).optional(),
}).strict();

export const proposalRevisionBodySchema = z.object({
  route: dashboardRouteSchema,
  note: z.string().trim().min(1).max(2_000),
}).strict();

export function refreshedProposal(variantId: string) {
  const workflowRunId = findWorkflowRunIdForProposal(variantId);
  if (!workflowRunId) {
    throw new AgentToolError("VALIDATION_ERROR", "Variant is not anchored to a writing workflow run", {
      reason: "proposal_run_anchor_missing",
    });
  }
  const proposal = getWorkflowRunProposal(workflowRunId, variantId);
  if (!proposal) {
    throw new AgentToolError("NOT_FOUND", `Workflow proposal not found: ${variantId}`);
  }
  return { workflowRunId, proposal, run: getWorkflowRun(workflowRunId) };
}
