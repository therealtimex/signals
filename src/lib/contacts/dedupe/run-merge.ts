import {
  createWorkflowRun,
  createWorkflowStep,
  nextStepIndex,
  updateWorkflowRun,
} from "@/lib/db/queries/workflows";
import { getTemplate, updateTemplate } from "@/lib/db/queries/workflow-templates";
import {
  ensureRtxWorkspace,
  getSignalsRtxWorkspaceSlug,
} from "@/lib/rtx/cli-provisioning";
import { isRtxEmbedded, type EnvLike } from "@/lib/rtx/env";
import { appendRtxThreadMessage } from "@/lib/rtx/runtime-sessions";
import { getOrCreateTemplateThread } from "@/lib/rtx/template-thread";
import {
  formatRunLabelPrefix,
  resolveTemplateThreadName,
} from "@/lib/workflows/template-brief";
import {
  MergeContactsError,
  mergeContacts,
  type MergeContactsResult,
} from "./merge";

export interface DedupeMergeGroupInput {
  primaryContactId: string;
  secondaryContactIds: string[];
}

export type DedupeMergeGroupResult =
  | { ok: true; result: MergeContactsResult }
  | { ok: false; primaryContactId: string; error: string; errorCode: string };

export interface RunDedupeMergeResult {
  /** Null for a dry run — a preview is not a run. */
  workflowRunId: string | null;
  threadPath: string | null;
  groups: DedupeMergeGroupResult[];
  merged: number;
  alreadyMerged: number;
  failed: number;
}

export interface RunDedupeMergeInput {
  groups: DedupeMergeGroupInput[];
  dryRun?: boolean;
  /** Attaches the run and its thread message to the dedupe template. */
  templateId?: string;
  env?: EnvLike;
  fetchImpl?: typeof fetch;
}

function summarize(groups: DedupeMergeGroupResult[]): {
  merged: number;
  alreadyMerged: number;
  failed: number;
} {
  let merged = 0;
  let alreadyMerged = 0;
  let failed = 0;

  for (const group of groups) {
    if (!group.ok) {
      failed += 1;
      continue;
    }
    for (const member of group.result.merged) {
      if (member.status === "merged") merged += 1;
      else if (member.status === "already_merged") alreadyMerged += 1;
    }
  }

  return { merged, alreadyMerged, failed };
}

function formatThreadMessage(
  groups: DedupeMergeGroupResult[],
  totals: { merged: number; alreadyMerged: number; failed: number }
): string {
  const lines = [
    `**Deduplicate & Merge Contacts** — reviewed in-app, ${groups.length} group${groups.length === 1 ? "" : "s"} merged.`,
    "",
  ];

  for (const group of groups) {
    if (!group.ok) {
      lines.push(`- ❌ \`${group.primaryContactId}\` — ${group.error}`);
      continue;
    }
    const names = group.result.merged.map((m) => `${m.name} (${m.status})`).join(", ");
    lines.push(`- **${group.result.primaryContactName}** ← ${names} · score ${group.result.enrichmentScore}`);
  }

  lines.push(
    "",
    `${totals.merged} merged · ${totals.alreadyMerged} already merged · ${totals.failed} failed.`
  );
  return lines.join("\n");
}

function mergeGroup(group: DedupeMergeGroupInput, dryRun: boolean): DedupeMergeGroupResult {
  try {
    return {
      ok: true,
      result: mergeContacts({
        primaryContactId: group.primaryContactId,
        secondaryContactIds: group.secondaryContactIds,
        options: { dryRun, reason: "Dedupe review panel" },
      }),
    };
  } catch (error) {
    if (error instanceof MergeContactsError) {
      return {
        ok: false,
        primaryContactId: group.primaryContactId,
        error: error.message,
        errorCode: error.code.toLowerCase(),
      };
    }
    throw error;
  }
}

/**
 * Merge reviewed duplicate groups in-process and report the batch the way the profile
 * pipeline does: a workflow run plus one message in the template's thread, with
 * `rtxRuntimeSessionId: null` marking that no terminal agent was involved.
 *
 * Groups merge sequentially — each one re-points rows the next may also touch.
 */
export async function runDedupeMerge(
  input: RunDedupeMergeInput
): Promise<RunDedupeMergeResult> {
  const env = input.env ?? process.env;
  const fetchImpl = input.fetchImpl ?? fetch;
  const dryRun = input.dryRun ?? false;

  if (dryRun) {
    const groups = input.groups.map((group) => mergeGroup(group, true));
    return { workflowRunId: null, threadPath: null, groups, ...summarize(groups) };
  }

  const template = input.templateId ? getTemplate(input.templateId) : undefined;
  const startedAt = Math.floor(Date.now() / 1000);
  const run = createWorkflowRun({
    templateId: template?.id ?? null,
    workflowType: "prune",
    status: "running",
    trigger: "template",
    startedAt,
    totalItems: input.groups.length,
    config: JSON.stringify({ source: "dedupe-review-panel", groups: input.groups }),
  });

  let threadPath: string | null = null;
  if (template && isRtxEmbedded(env)) {
    try {
      const workspaceSlug = await ensureRtxWorkspace(
        getSignalsRtxWorkspaceSlug(env),
        "Signals",
        env,
        fetchImpl
      );
      const { threadSlug } = await getOrCreateTemplateThread(
        {
          template,
          workspaceSlug,
          threadName: resolveTemplateThreadName(template),
        },
        env,
        fetchImpl
      );
      threadPath = `/workspace/${workspaceSlug}/t/${threadSlug}`;
      updateWorkflowRun(run.id, {
        config: JSON.stringify({
          source: "dedupe-review-panel",
          groups: input.groups,
          rtxWorkspaceSlug: workspaceSlug,
          rtxThreadSlug: threadSlug,
          // No terminal agent runs this — the merge already happened in-process.
          rtxRuntimeSessionId: null,
        }),
      });

      const runNumber = template.totalRuns + 1;
      updateTemplate(template.id, { totalRuns: runNumber, lastRunAt: startedAt });

      const groups = input.groups.map((group) => mergeGroup(group, false));
      const totals = summarize(groups);
      recordSteps(run.id, groups);

      await appendRtxThreadMessage(
        {
          workspaceSlug,
          threadSlug,
          message: `${formatRunLabelPrefix(runNumber)}${formatThreadMessage(groups, totals)}`,
          reason: `Dedupe review merge ${run.id}`,
        },
        env,
        fetchImpl
      );

      completeRun(run.id, groups, totals, startedAt);
      return { workflowRunId: run.id, threadPath, groups, ...totals };
    } catch (error) {
      // Thread provisioning must never cost the merge — fall through and run untethered.
      updateWorkflowRun(run.id, {
        errors: JSON.stringify([
          error instanceof Error ? error.message : "Thread provisioning failed",
        ]),
      });
    }
  }

  const groups = input.groups.map((group) => mergeGroup(group, false));
  const totals = summarize(groups);
  recordSteps(run.id, groups);
  completeRun(run.id, groups, totals, startedAt);

  return { workflowRunId: run.id, threadPath, groups, ...totals };
}

function recordSteps(workflowRunId: string, groups: DedupeMergeGroupResult[]): void {
  for (const group of groups) {
    createWorkflowStep({
      workflowRunId,
      stepIndex: nextStepIndex(workflowRunId),
      stepType: "contact_merge",
      status: group.ok ? "completed" : "failed",
      // workflow_steps.contact_id is a real FK, and a group can fail precisely because the
      // primary does not exist — carry the id in `input` instead of breaking the insert.
      contactId: group.ok ? group.result.primaryContactId : null,
      tool: "merge_contacts",
      input: JSON.stringify(
        group.ok
          ? { primaryContactId: group.result.primaryContactId }
          : { primaryContactId: group.primaryContactId }
      ),
      output: group.ok ? JSON.stringify(group.result) : "{}",
      error: group.ok ? null : group.error,
    });
  }
}

function completeRun(
  workflowRunId: string,
  groups: DedupeMergeGroupResult[],
  totals: { merged: number; alreadyMerged: number; failed: number },
  startedAt: number
): void {
  updateWorkflowRun(workflowRunId, {
    status: totals.failed === groups.length && groups.length > 0 ? "failed" : "completed",
    completedAt: Math.max(startedAt, Math.floor(Date.now() / 1000)),
    processedItems: groups.length,
    successItems: totals.merged,
    skippedItems: totals.alreadyMerged,
    errorItems: totals.failed,
    result: JSON.stringify(totals),
  });
}
