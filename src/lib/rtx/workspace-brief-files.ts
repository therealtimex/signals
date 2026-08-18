import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { EnvLike } from "@/lib/rtx/env";
import { resolveRtxWorkspaceWorkingDir } from "@/lib/rtx/storage-path";

export function workflowRunBriefRelativePath(runId: string): string {
  return `workflow-runs/${runId}/brief.md`;
}

export function publishJobBriefRelativePath(jobId: string): string {
  return `publish-jobs/${jobId}/brief.md`;
}

export function buildWorkflowRunBriefRoutingMessage(runId: string): string {
  return `Execute the Signals workflow brief at \`workflow-runs/${runId}/brief.md\`. Report a concise summary in this thread when finished.`;
}

export function buildPublishJobBriefRoutingMessage(jobId: string): string {
  return `Execute the Signals publish brief at \`publish-jobs/${jobId}/brief.md\`. Report a concise summary in this thread when finished.`;
}

export type WriteWorkspaceBriefResult =
  | { success: true; relativePath: string }
  | { success: false; error: string };

export async function writeRtxWorkspaceBriefFile(
  workspaceSlug: string,
  relativePath: string,
  content: string,
  env: EnvLike = process.env
): Promise<WriteWorkspaceBriefResult> {
  const workspaceDir = resolveRtxWorkspaceWorkingDir(workspaceSlug, env);
  if (!workspaceDir) {
    return {
      success: false,
      error:
        "Cannot resolve the RealTimeX workspace directory. Ensure STORAGE_DIR or REALTIMEX_USER_DATA_PATH is available in the Local App environment.",
    };
  }

  const filePath = join(workspaceDir, relativePath);
  try {
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, content, "utf8");
    return { success: true, relativePath };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to write brief file",
    };
  }
}
