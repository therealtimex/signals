import { appendRtxThreadMessage } from "@/lib/rtx/runtime-sessions";
import type { EnvLike } from "@/lib/rtx/env";

export function formatOrchestratorDispatchThreadMessage(input: {
  parentRunId: string;
  followOnAction?: string | null;
  targetTemplateName?: string | null;
  childRunIds: string[];
}): string {
  const lines = [
    "**Orchestrator dispatch — Done**",
    "",
    `Parent run \`${input.parentRunId}\``,
    `Follow-on: **${input.followOnAction?.trim() || "workflow"}**`,
  ];

  if (input.targetTemplateName?.trim()) {
    lines.push(`Template: ${input.targetTemplateName.trim()}`);
  }

  if (input.childRunIds.length > 0) {
    lines.push("", "Child runs:");
    for (const childRunId of input.childRunIds) {
      lines.push(`- \`${childRunId}\``);
    }
  }

  return lines.join("\n");
}

export async function postOrchestratorDispatchThreadMessage(
  input: {
    workspaceSlug: string;
    threadSlug: string;
    parentRunId: string;
    followOnAction?: string | null;
    targetTemplateName?: string | null;
    childRunIds: string[];
  },
  env: EnvLike = process.env,
  fetchImpl: typeof fetch = fetch
): Promise<{ posted: boolean; error?: string }> {
  const workspaceSlug = input.workspaceSlug.trim();
  const threadSlug = input.threadSlug.trim();
  if (!workspaceSlug || !threadSlug) {
    return { posted: false };
  }

  const message = formatOrchestratorDispatchThreadMessage(input);
  const result = await appendRtxThreadMessage(
    {
      workspaceSlug,
      threadSlug,
      message,
      reason: `Orchestrator dispatched follow-on for ${input.parentRunId}`,
    },
    env,
    fetchImpl
  );

  if (!result.success) {
    return { posted: false, error: result.error };
  }

  return { posted: true };
}
