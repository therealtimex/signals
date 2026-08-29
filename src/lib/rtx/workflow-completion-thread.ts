import { getTemplate } from "@/lib/db/queries/workflow-templates";
import type { WorkflowRun } from "@/lib/db/types";
import { getRtxRefsFromRunConfig } from "@/lib/agents/run-template-via-rtx";
import { appendRtxThreadMessage } from "@/lib/rtx/runtime-sessions";
import type { EnvLike } from "@/lib/rtx/env";
import { formatRunLabelPrefix } from "@/lib/workflows/template-brief";

export function formatWorkflowCompletionThreadMessage(
  run: WorkflowRun,
  input: {
    status: string;
    summary?: string;
    processedItems?: number;
    successItems?: number;
  }
): string {
  let templateName = "Workflow";
  try {
    const config = JSON.parse(run.config ?? "{}") as Record<string, unknown>;
    if (typeof config.templateName === "string" && config.templateName.trim()) {
      templateName = config.templateName.trim();
    }
  } catch {
    // Malformed config must not block completion messaging.
  }

  const lines = [
    `**${templateName} — Done**`,
    "",
    `Run \`${run.id}\``,
    `Status: **${input.status}**`,
  ];

  if (input.summary?.trim()) {
    lines.push("", input.summary.trim());
  } else if (input.processedItems !== undefined) {
    const success =
      input.successItems !== undefined ? ` · Success: ${input.successItems}` : "";
    lines.push("", `Processed: ${input.processedItems}${success}`);
  }

  return lines.join("\n");
}

export async function postWorkflowCompletionThreadMessage(
  run: WorkflowRun,
  input: {
    status: string;
    summary?: string;
    processedItems?: number;
    successItems?: number;
  },
  env: EnvLike = process.env,
  fetchImpl: typeof fetch = fetch
): Promise<{ posted: boolean; error?: string }> {
  const { workspaceSlug, threadSlug } = getRtxRefsFromRunConfig(run.config);
  if (!workspaceSlug || !threadSlug) {
    return { posted: false };
  }

  const template = run.templateId ? getTemplate(run.templateId) : null;
  const runNumber =
    template?.totalRuns && template.totalRuns > 0 ? template.totalRuns : undefined;
  const message = `${formatRunLabelPrefix(runNumber)}${formatWorkflowCompletionThreadMessage(run, input)}`;

  const result = await appendRtxThreadMessage(
    {
      workspaceSlug,
      threadSlug,
      message,
      reason: `Workflow run ${run.id} completed`,
    },
    env,
    fetchImpl
  );

  if (!result.success) {
    return { posted: false, error: result.error };
  }

  return { posted: true };
}
