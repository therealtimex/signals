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

export function personaJobBriefRelativePath(jobId: string): string {
  return `persona-jobs/${jobId}/brief.md`;
}

export function orchestratorEventBriefRelativePath(runId: string): string {
  return `orchestrator-events/${runId}/brief.md`;
}

export interface WorkflowRunBriefRoutingInput {
  runId: string;
  templateName?: string | null;
  runNumber?: number;
  absolutePath?: string;
}

export interface PublishJobBriefRoutingInput {
  jobId: string;
  title?: string | null;
  platforms?: string[];
  absolutePath?: string;
}

export interface PersonaJobBriefRoutingInput {
  jobId: string;
  contactId: string;
  contactName?: string | null;
  absolutePath?: string;
}

export interface OrchestratorBriefRoutingInput {
  runId: string;
  templateName?: string | null;
  eventType?: string | null;
  suggestedAction?: string | null;
  absolutePath?: string;
}

export function buildWorkflowRunBriefRoutingMessage(
  runIdOrInput: string | WorkflowRunBriefRoutingInput
): string {
  if (typeof runIdOrInput === "string") {
    return [
      "Signals workflow handoff",
      `Run: ${runIdOrInput}`,
      "State: ready",
      "Type: workflow-brief",
      "Context: Follow workspace guidelines and operating model in AGENTS.md.",
      "Required: Read the brief file before acting and follow its instructions.",
      `File: @workflow-runs/${runIdOrInput}/brief.md`,
    ].join("\n");
  }

  const { runId, templateName, runNumber, absolutePath } = runIdOrInput;
  const targetPath = absolutePath ? `@${absolutePath}` : `@workflow-runs/${runId}/brief.md`;
  const name = templateName?.trim() || "Workflow";
  const runLabel = runNumber && runNumber > 0 ? `#${runNumber} (${runId})` : runId;

  return [
    `Signals workflow handoff -> ${name}`,
    `Run: ${runLabel}`,
    "State: ready",
    "Type: workflow-brief",
    "Context: Follow workspace guidelines and operating model in AGENTS.md.",
    "Required: Read the brief file before acting and follow its instructions.",
    `File: ${targetPath}`,
  ].join("\n");
}

export function buildPublishJobBriefRoutingMessage(
  jobIdOrInput: string | PublishJobBriefRoutingInput
): string {
  if (typeof jobIdOrInput === "string") {
    return [
      "Signals publish handoff",
      `Job: ${jobIdOrInput}`,
      "State: ready",
      "Type: publish-brief",
      "Context: Follow workspace guidelines and operating model in AGENTS.md.",
      "Required: Read the brief file before acting and follow its instructions.",
      `File: @publish-jobs/${jobIdOrInput}/brief.md`,
    ].join("\n");
  }

  const { jobId, title, platforms, absolutePath } = jobIdOrInput;
  const targetPath = absolutePath ? `@${absolutePath}` : `@publish-jobs/${jobId}/brief.md`;
  const postTitle = title?.trim() || "Social Post";
  const platformList = platforms && platforms.length > 0 ? platforms.join(", ") : undefined;

  const lines = [
    `Signals publish handoff -> ${postTitle}`,
    `Job: ${jobId}`,
    platformList ? `Platforms: ${platformList}` : null,
    "State: ready",
    "Type: publish-brief",
    "Context: Follow workspace guidelines and operating model in AGENTS.md.",
    "Required: Read the brief file before acting and follow its instructions.",
    `File: ${targetPath}`,
  ].filter(Boolean) as string[];

  return lines.join("\n");
}

export function buildPersonaJobBriefRoutingMessage(
  jobIdOrInput: string | PersonaJobBriefRoutingInput,
): string {
  if (typeof jobIdOrInput === "string") {
    return [
      "Signals persona handoff",
      `Job: ${jobIdOrInput}`,
      "State: ready",
      "Type: persona-brief",
      "Context: Follow workspace guidelines and operating model in AGENTS.md.",
      "Required: Read the brief file before acting and follow its instructions. This job is stateless; ignore prior threads.",
      `File: @persona-jobs/${jobIdOrInput}/brief.md`,
    ].join("\n");
  }

  const { jobId, contactId, contactName, absolutePath } = jobIdOrInput;
  const targetPath = absolutePath ? `@${absolutePath}` : `@persona-jobs/${jobId}/brief.md`;
  return [
    `Signals persona handoff -> ${contactName?.trim() || "Contact"}`,
    `Job: ${jobId}`,
    `Contact: ${contactId}`,
    "State: ready",
    "Type: persona-brief",
    "Context: Follow workspace guidelines and operating model in AGENTS.md.",
    "Required: Read the brief file before acting and follow its instructions. This job is stateless; ignore prior threads.",
    `File: ${targetPath}`,
  ].join("\n");
}

export function buildOrchestratorBriefRoutingMessage(
  runIdOrInput: string | OrchestratorBriefRoutingInput
): string {
  if (typeof runIdOrInput === "string") {
    return [
      "Signals orchestrator handoff",
      `Run: ${runIdOrInput}`,
      "Event: workflow.completed",
      "State: ready",
      "Type: orchestrator-brief",
      "Context: Follow workspace guidelines and operating model in AGENTS.md.",
      "Required: Read the brief file before acting and follow its instructions.",
      `File: @orchestrator-events/${runIdOrInput}/brief.md`,
    ].join("\n");
  }

  const { runId, templateName, eventType, suggestedAction, absolutePath } = runIdOrInput;
  const targetPath = absolutePath ? `@${absolutePath}` : `@orchestrator-events/${runId}/brief.md`;
  const name = templateName?.trim() || "Workflow";
  const event = eventType?.trim() || "workflow.completed";

  const lines = [
    `Signals orchestrator handoff -> ${name} (${runId})`,
    `Event: ${event}`,
    suggestedAction ? `Recommendation: ${suggestedAction}` : null,
    "State: ready",
    "Type: orchestrator-brief",
    "Context: Follow workspace guidelines and operating model in AGENTS.md.",
    "Required: Read the brief file before acting and follow its instructions.",
    `File: ${targetPath}`,
  ].filter(Boolean) as string[];

  return lines.join("\n");
}

export type WriteWorkspaceBriefResult =
  | { success: true; relativePath: string; absolutePath: string }
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
    return { success: true, relativePath, absolutePath: filePath };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to write brief file",
    };
  }
}
