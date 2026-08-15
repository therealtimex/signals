import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { simulationRuns, variants } from "@/lib/db/schema";
import {
  calibrateSimulationRun,
  getLatestCalibrationForRun,
} from "@/lib/db/queries/calibrations";
import { CalibrationSourceError } from "@/lib/db/queries/simulation-errors";
import {
  createWorkflowRun,
  createWorkflowStep,
  nextStepIndex,
  updateWorkflowRun,
} from "@/lib/db/queries/workflows";
import type { SimulationRun } from "@/lib/db/types";

export const SIMULATION_CALIBRATION_SWEEP_JOB_TYPE =
  "maintenance:simulation-calibration-sweep";

export type CalibrationSweepReport = {
  workflowRunId: string;
  observedUntil: number;
  runsConsidered: number;
  runsCalibrated: number;
  runsSkipped: number;
  errors: { runId: string; message: string }[];
};

function listCompletedRunsForPublishedVariants(): SimulationRun[] {
  const publishedVariantIds = db
    .select({ id: variants.id })
    .from(variants)
    .where(eq(variants.status, "published"))
    .all()
    .map((row) => row.id);

  if (publishedVariantIds.length === 0) return [];

  return db
    .select()
    .from(simulationRuns)
    .where(
      and(
        inArray(simulationRuns.variantId, publishedVariantIds),
        eq(simulationRuns.status, "completed"),
      ),
    )
    .orderBy(desc(simulationRuns.completedAt), desc(simulationRuns.id))
    .all();
}

export function runNeedsCalibrationAtHorizon(runId: string, observedUntil: number): boolean {
  const latest = getLatestCalibrationForRun(runId);
  if (!latest) return true;
  return latest.observedUntil < observedUntil;
}

/** Workflow-owned calibration sweep for published variants (§7.5 / ADR-022-12). */
export function runSimulationCalibrationSweep(opts?: {
  observedUntil?: number;
  now?: number;
}): CalibrationSweepReport {
  const now = opts?.now ?? Math.floor(Date.now() / 1000);
  const observedUntil = opts?.observedUntil ?? now;

  const workflowRun = createWorkflowRun({
    workflowType: "calibrate",
    status: "running",
    trigger: "scheduled",
    config: JSON.stringify({ observedUntil }),
    startedAt: now,
  });

  const report: CalibrationSweepReport = {
    workflowRunId: workflowRun.id,
    observedUntil,
    runsConsidered: 0,
    runsCalibrated: 0,
    runsSkipped: 0,
    errors: [],
  };

  try {
    for (const run of listCompletedRunsForPublishedVariants()) {
      report.runsConsidered += 1;

      if (!runNeedsCalibrationAtHorizon(run.id, observedUntil)) {
        report.runsSkipped += 1;
        continue;
      }

      try {
        calibrateSimulationRun(run.id, {
          observedUntil,
          provenance: { source: "workflow", workflowRunId: workflowRun.id },
        });
        report.runsCalibrated += 1;
      } catch (err) {
        if (err instanceof CalibrationSourceError) {
          report.runsSkipped += 1;
          continue;
        }
        report.errors.push({
          runId: run.id,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }

    updateWorkflowRun(workflowRun.id, {
      status: report.errors.length > 0 && report.runsCalibrated === 0 ? "failed" : "completed",
      totalItems: report.runsConsidered,
      processedItems: report.runsConsidered,
      successItems: report.runsCalibrated,
      skippedItems: report.runsSkipped,
      errorItems: report.errors.length,
      result: JSON.stringify(report),
      errors: JSON.stringify(report.errors.map((entry) => entry.message)),
      completedAt: Math.floor(Date.now() / 1000),
    });

    createWorkflowStep({
      workflowRunId: workflowRun.id,
      stepIndex: nextStepIndex(workflowRun.id),
      stepType: "decision",
      status: "completed",
      output: JSON.stringify({
        runsCalibrated: report.runsCalibrated,
        runsSkipped: report.runsSkipped,
        errorCount: report.errors.length,
      }),
      tool: "simulation_calibration_sweep",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    updateWorkflowRun(workflowRun.id, {
      status: "failed",
      errorItems: 1,
      errors: JSON.stringify([message]),
      completedAt: Math.floor(Date.now() / 1000),
    });
    throw err;
  }

  return report;
}
