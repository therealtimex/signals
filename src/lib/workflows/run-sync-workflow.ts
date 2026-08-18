import {
  createWorkflowRun,
  updateWorkflowRun,
  createWorkflowStep,
  nextStepIndex,
} from "@/lib/db/queries/workflows";
import type { SyncResult } from "@/lib/platforms/adapter";
import type { WorkflowRun } from "@/lib/db/types";
import type { WorkflowType, WorkflowConfig, SyncSubType } from "@/lib/workflows/types";
import { SYNC_SUBTYPE_LABELS } from "@/lib/workflows/types";

interface RunSyncWorkflowOpts {
  workflowType: WorkflowType;
  syncSubType: SyncSubType;
  platformAccountId: string;
  templateId?: string;
  syncFunction: (workflowRunId: string) => Promise<SyncResult>;
}

/**
 * Wraps an existing sync/enrich function with workflow observability.
 * Creates a workflowRuns row, executes the sync, maps the result to
 * workflow progress counters, and creates summary steps.
 */
export async function runSyncWorkflow(
  opts: RunSyncWorkflowOpts
): Promise<{ workflowRun: WorkflowRun; syncResult: SyncResult }> {
  const now = Math.floor(Date.now() / 1000);
  const label = SYNC_SUBTYPE_LABELS[opts.syncSubType] ?? opts.syncSubType;

  const config: WorkflowConfig = {
    syncSubType: opts.syncSubType,
    platformAccountId: opts.platformAccountId,
  };

  // 1. Create workflow run
  const run = createWorkflowRun({
    workflowType: opts.workflowType,
    platformAccountId: opts.platformAccountId,
    templateId: opts.templateId,
    status: "running",
    config: JSON.stringify(config),
    startedAt: now,
  });

  // 2. Record start step
  createWorkflowStep({
    workflowRunId: run.id,
    stepIndex: 0,
    stepType: "sync_page",
    status: "running",
    input: JSON.stringify({ syncSubType: opts.syncSubType }),
    output: "{}",
    tool: label,
  });

  let syncResult: SyncResult;

  try {
    // 3. Execute the actual sync function
    syncResult = await opts.syncFunction(run.id);

    // 4. Map SyncResult to workflow counters
    const successItems = syncResult.added + syncResult.updated;
    const processedItems = successItems + syncResult.skipped;
    const completedAt = Math.floor(Date.now() / 1000);
    const durationMs = (completedAt - now) * 1000;

    // 5. Update the run with results
    const finalStatus = syncResult.errors.length > 0 && successItems === 0
      ? "failed" as const
      : "completed" as const;

    updateWorkflowRun(run.id, {
      status: finalStatus,
      totalItems: processedItems,
      processedItems,
      successItems,
      skippedItems: syncResult.skipped,
      errorItems: syncResult.errors.length,
      result: JSON.stringify(syncResult),
      errors: JSON.stringify(syncResult.errors),
      completedAt,
    });

    // 6. Create summary step
    createWorkflowStep({
      workflowRunId: run.id,
      stepIndex: nextStepIndex(run.id),
      stepType: "sync_page",
      status: finalStatus === "failed" ? "failed" : "completed",
      output: JSON.stringify({
        added: syncResult.added,
        updated: syncResult.updated,
        skipped: syncResult.skipped,
        errorCount: syncResult.errors.length,
      }),
      tool: label,
      durationMs,
    });

    // 7. If there were errors, log them as error steps
    for (const errMsg of syncResult.errors.slice(0, 10)) {
      createWorkflowStep({
        workflowRunId: run.id,
        stepIndex: nextStepIndex(run.id),
        stepType: "error",
        status: "failed",
        error: errMsg,
        tool: label,
      });
    }
  } catch (err) {
    // Workflow-level failure (sync function threw)
    const errorMessage = err instanceof Error ? err.message : String(err);
    syncResult = { added: 0, updated: 0, skipped: 0, errors: [errorMessage] };

    updateWorkflowRun(run.id, {
      status: "failed",
      errorItems: 1,
      result: JSON.stringify(syncResult),
      errors: JSON.stringify([errorMessage]),
      completedAt: Math.floor(Date.now() / 1000),
    });

    createWorkflowStep({
      workflowRunId: run.id,
      stepIndex: nextStepIndex(run.id),
      stepType: "error",
      status: "failed",
      error: errorMessage,
      tool: label,
      durationMs: (Math.floor(Date.now() / 1000) - now) * 1000,
    });
  }

  // Re-fetch the final state
  const finalRun = updateWorkflowRun(run.id, {}) ?? run;

  return { workflowRun: finalRun, syncResult };
}
