import type { WorkflowRun } from "@/lib/db/types";
import { getRtxRefsFromRunConfig } from "@/lib/rtx/workflow-run-refs";

const TERMINAL_RUN_STATUSES = new Set(["completed", "failed", "cancelled"]);

export type WorkflowRunAgentThread =
  | { state: "connecting"; threadPath: null }
  | { state: "available"; threadPath: string }
  | { state: "none"; threadPath: null };

export type WorkflowRunAgentThreadTarget = {
  workspaceSlug: string;
  threadSlug: string;
  threadPath: string;
};

type WorkflowRunThreadSource = Pick<
  WorkflowRun,
  "config" | "status" | "templateId"
>;

/**
 * Resolve the server-owned thread target stored on a workflow run.
 *
 * Consumers must not infer a thread from a terminal session ID or display
 * name: only the workspace/thread pair persisted after RTX resolution is a
 * navigable identity.
 */
export function getWorkflowRunAgentThreadTarget(
  run: Pick<WorkflowRun, "config">,
): WorkflowRunAgentThreadTarget | null {
  const refs = getRtxRefsFromRunConfig(run.config);
  const workspaceSlug = refs.workspaceSlug?.trim();
  const threadSlug = refs.threadSlug?.trim();
  if (!workspaceSlug || !threadSlug) return null;

  return {
    workspaceSlug,
    threadSlug,
    threadPath: `/workspace/${workspaceSlug}/t/${threadSlug}`,
  };
}

export function resolveWorkflowRunAgentThread(
  run: WorkflowRunThreadSource,
): WorkflowRunAgentThread {
  const target = getWorkflowRunAgentThreadTarget(run);
  if (target) {
    return { state: "available", threadPath: target.threadPath };
  }

  if (run.templateId && !TERMINAL_RUN_STATUSES.has(run.status)) {
    return { state: "connecting", threadPath: null };
  }

  return { state: "none", threadPath: null };
}
