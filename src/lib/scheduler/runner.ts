import {
  getDueJobs,
  getScheduledJob,
  updateScheduledJob,
  rescheduleJob,
} from "@/lib/db/queries/scheduled-jobs";
import { getTemplate } from "@/lib/db/queries/workflow-templates";
import { startAgentWorkflow, AGENT_ORCHESTRATION_MESSAGE } from "@/lib/agents/run-agent-workflow";
import {
  pruneSimulationTranscripts,
  SIMULATION_TRANSCRIPT_RETENTION_JOB_TYPE,
} from "@/lib/db/simulation-transcript-retention";
import {
  runSimulationCalibrationSweep,
  SIMULATION_CALIBRATION_SWEEP_JOB_TYPE,
} from "@/lib/db/simulation-calibration-sweep";
import {
  runPersonaRefreshSweep,
  PERSONA_REFRESH_JOB_TYPE,
} from "@/lib/db/persona-refresh-sweep";
import type { WorkflowType } from "@/lib/workflows/types";

const CHECK_INTERVAL_MS = 60_000; // 1 minute

/** Map templateType to workflowType (same mapping as activate API). */
const TEMPLATE_TO_WORKFLOW_TYPE: Record<string, WorkflowType> = {
  prospecting: "search",
  enrichment: "enrich",
  pruning: "prune",
  outreach: "sequence",
  engagement: "agent",
  content: "agent",
  nurture: "agent",
};

type MaintenanceHandler = (payload: Record<string, unknown>) => unknown;

const MAINTENANCE_HANDLERS: Record<string, MaintenanceHandler> = {
  [SIMULATION_TRANSCRIPT_RETENTION_JOB_TYPE]: (payload) =>
    pruneSimulationTranscripts({
      retentionDays:
        typeof payload.retentionDays === "number" ? payload.retentionDays : undefined,
    }),
  [SIMULATION_CALIBRATION_SWEEP_JOB_TYPE]: (payload) =>
    runSimulationCalibrationSweep({
      observedUntil:
        typeof payload.observedUntil === "number" ? payload.observedUntil : undefined,
    }),
  [PERSONA_REFRESH_JOB_TYPE]: () => runPersonaRefreshSweep(),
};

let initialized = false;
let intervalId: ReturnType<typeof setInterval> | null = null;

/**
 * Initialize the background scheduler.
 * Guards against double-init. Checks for overdue jobs immediately on startup,
 * then polls every 60 seconds.
 */
export function initScheduler(): void {
  if (initialized) return;
  initialized = true;

  console.log("[scheduler] Initializing background scheduler...");

  // Check for overdue jobs immediately
  checkDueJobs();

  // Then check every minute
  intervalId = setInterval(checkDueJobs, CHECK_INTERVAL_MS);

  // Unref to avoid keeping the process alive just for scheduling
  if (intervalId && typeof intervalId === "object" && "unref" in intervalId) {
    intervalId.unref();
  }
}

/** Stop the scheduler (for testing / cleanup). */
export function stopScheduler(): void {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
  initialized = false;
}

/** Check for due jobs and execute them. */
function checkDueJobs(): void {
  try {
    const dueJobs = getDueJobs();
    if (dueJobs.length > 0) {
      console.log(`[scheduler] Found ${dueJobs.length} due job(s)`);
    }
    for (const job of dueJobs) {
      executeScheduledJob(job.id);
    }
  } catch (err) {
    console.error("[scheduler] Error checking due jobs:", err);
  }
}

/** Execute a single scheduled job (exported for tests). */
export function executeScheduledJob(jobId: string): void {
  const job = getScheduledJob(jobId);
  if (!job) return;

  // Mark as running
  updateScheduledJob(jobId, {
    status: "running",
    startedAt: Math.floor(Date.now() / 1000),
  });

  try {
    const maintenanceHandler = MAINTENANCE_HANDLERS[job.jobType];
    if (maintenanceHandler) {
      const payload = JSON.parse(job.payload ?? "{}") as Record<string, unknown>;
      const maintenanceResult = maintenanceHandler(payload);
      const completeMaintenance = () => {
        console.log(`[scheduler] Ran maintenance job ${jobId} (${job.jobType})`);

        updateScheduledJob(jobId, {
          status: "completed",
          completedAt: Math.floor(Date.now() / 1000),
        });

        if (job.cronExpression) {
          rescheduleJob(jobId);
          console.log(`[scheduler] Rescheduled maintenance job ${jobId} for next cron interval`);
        }
      };

      if (maintenanceResult instanceof Promise) {
        void maintenanceResult.then(completeMaintenance).catch((err: unknown) => {
          const errorMessage = err instanceof Error ? err.message : String(err);
          console.error(`[scheduler] Job ${jobId} failed:`, errorMessage);
          updateScheduledJob(jobId, {
            status: "failed",
            error: errorMessage,
            completedAt: Math.floor(Date.now() / 1000),
          });
        });
        return;
      }

      completeMaintenance();
      return;
    }

    if (!job.templateId) {
      throw new Error(`Unknown job_type without templateId: ${job.jobType}`);
    }

    const template = getTemplate(job.templateId);
    if (!template) {
      throw new Error(`Template not found: ${job.templateId}`);
    }

    // Determine workflow type
    const workflowType = TEMPLATE_TO_WORKFLOW_TYPE[template.templateType] ?? "agent";

    // Merge job config with template config
    const templateConfig = JSON.parse(template.config ?? "{}");
    const jobPayload = JSON.parse(job.payload ?? "{}");
    const mergedConfig = { ...templateConfig, ...jobPayload };

    // Start the workflow (records run; in-process orchestration removed — see RTX migration)
    const run = startAgentWorkflow({
      templateId: job.templateId,
      workflowType,
      config: mergedConfig,
    });

    if (run.status === "failed") {
      const errors = JSON.parse(run.errors ?? "[]") as string[];
      const errorMessage = errors[0] ?? AGENT_ORCHESTRATION_MESSAGE;

      console.error(
        `[scheduler] Agent orchestration unavailable for job ${jobId} (template: ${template.name}): ${errorMessage}`
      );

      updateScheduledJob(jobId, {
        status: "failed",
        error: errorMessage,
        completedAt: Math.floor(Date.now() / 1000),
        lastTriggeredAt: Math.floor(Date.now() / 1000),
      });
      return;
    }

    console.log(
      `[scheduler] Started workflow for job ${jobId} (template: ${template.name})`
    );

    // Mark as completed
    updateScheduledJob(jobId, {
      status: "completed",
      completedAt: Math.floor(Date.now() / 1000),
    });

    // If this is a recurring job (has cron), reschedule for the next run
    if (job.cronExpression) {
      rescheduleJob(jobId);
      console.log(`[scheduler] Rescheduled job ${jobId} for next cron interval`);
    }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error(`[scheduler] Job ${jobId} failed:`, errorMessage);

    updateScheduledJob(jobId, {
      status: "failed",
      error: errorMessage,
      completedAt: Math.floor(Date.now() / 1000),
    });
  }
}
