import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  simulationAgents,
  simulationRuns,
  simulationTranscripts,
} from "@/lib/db/schema";

export const SIMULATION_TRANSCRIPT_RETENTION_JOB_TYPE =
  "maintenance:simulation-transcript-retention";

export const DEFAULT_TRANSCRIPT_RETENTION_DAYS = 30;

export type TranscriptRetentionReport = {
  scannedAt: number;
  runsProcessed: number;
  transcriptsDeleted: number;
  bytesFreed: number;
  runsMarkedPruned: number;
};

function protectedRunIds(now: number, retentionDays: number): Set<string> {
  const cutoff = now - retentionDays * 86_400;
  const protectedIds = new Set<string>();

  const variantIds = db
    .selectDistinct({ variantId: simulationRuns.variantId })
    .from(simulationRuns)
    .all();

  for (const { variantId } of variantIds) {
    const latest = db
      .select()
      .from(simulationRuns)
      .where(
        and(eq(simulationRuns.variantId, variantId), eq(simulationRuns.status, "completed")),
      )
      .orderBy(desc(simulationRuns.completedAt), desc(simulationRuns.id))
      .get();
    if (latest) protectedIds.add(latest.id);
  }

  const recentRuns = db
    .select({ id: simulationRuns.id })
    .from(simulationRuns)
    .where(sql`${simulationRuns.createdAt} >= ${cutoff}`)
    .all();
  for (const run of recentRuns) {
    protectedIds.add(run.id);
  }

  return protectedIds;
}

/** Idempotent retention job — prunes transcripts outside the §4.2 policy window. */
export function pruneSimulationTranscripts(opts?: {
  retentionDays?: number;
  now?: number;
}): TranscriptRetentionReport {
  const now = opts?.now ?? Math.floor(Date.now() / 1000);
  const retentionDays = opts?.retentionDays ?? DEFAULT_TRANSCRIPT_RETENTION_DAYS;
  const keepRunIds = protectedRunIds(now, retentionDays);

  const runsWithTranscripts = db
    .selectDistinct({ runId: simulationAgents.simulationRunId })
    .from(simulationTranscripts)
    .innerJoin(simulationAgents, eq(simulationTranscripts.simulationAgentId, simulationAgents.id))
    .all();

  let transcriptsDeleted = 0;
  let bytesFreed = 0;
  let runsMarkedPruned = 0;

  for (const { runId } of runsWithTranscripts) {
    if (keepRunIds.has(runId)) continue;

    const run = db.select().from(simulationRuns).where(eq(simulationRuns.id, runId)).get();
    if (!run) continue;

    const agentIds = db
      .select({ id: simulationAgents.id })
      .from(simulationAgents)
      .where(eq(simulationAgents.simulationRunId, runId))
      .all()
      .map((row) => row.id);

    if (agentIds.length === 0) continue;

    const doomed = db
      .select()
      .from(simulationTranscripts)
      .where(inArray(simulationTranscripts.simulationAgentId, agentIds))
      .all();

    if (doomed.length === 0) continue;

    for (const row of doomed) {
      bytesFreed += row.byteSize;
    }
    transcriptsDeleted += doomed.length;

    db.delete(simulationTranscripts)
      .where(inArray(simulationTranscripts.simulationAgentId, agentIds))
      .run();

    db.update(simulationRuns)
      .set({ transcriptsPrunedAt: now, updatedAt: now })
      .where(eq(simulationRuns.id, runId))
      .run();

    runsMarkedPruned += 1;
  }

  return {
    scannedAt: now,
    runsProcessed: runsWithTranscripts.length,
    transcriptsDeleted,
    bytesFreed,
    runsMarkedPruned,
  };
}

/** Summary for Sync Health alongside graph-integrity output. */
export function getSimulationTranscriptRetentionSummary(): {
  transcriptCount: number;
  totalBytes: number;
  lastPrunedAt: number | null;
} {
  const stats = db
    .select({
      transcriptCount: sql<number>`count(*)`,
      totalBytes: sql<number>`coalesce(sum(${simulationTranscripts.byteSize}), 0)`,
    })
    .from(simulationTranscripts)
    .get();

  const lastPruned = db
    .select({ prunedAt: simulationRuns.transcriptsPrunedAt })
    .from(simulationRuns)
    .where(sql`${simulationRuns.transcriptsPrunedAt} IS NOT NULL`)
    .orderBy(desc(simulationRuns.transcriptsPrunedAt))
    .get();

  return {
    transcriptCount: stats?.transcriptCount ?? 0,
    totalBytes: stats?.totalBytes ?? 0,
    lastPrunedAt: lastPruned?.prunedAt ?? null,
  };
}
