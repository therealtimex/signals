import type { LaunchWithDetails } from "@/lib/db/queries/launches";
import type { getSimulationRun } from "@/lib/db/queries/simulations";
import type { Variant } from "@/lib/db/types";

function parseJsonRecord(value: string | null | undefined): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export function serializeLaunch(launch: LaunchWithDetails) {
  return {
    id: launch.id,
    name: launch.name,
    brief: launch.brief,
    status: launch.status,
    primaryPlatform: launch.primaryPlatform,
    audienceSpec: parseJsonRecord(launch.audienceSpec),
    workflowTemplateId: launch.workflowTemplateId,
    scope: launch.scope,
    source: launch.source,
    metadata: parseJsonRecord(launch.metadata),
    launchedAt: launch.launchedAt,
    completedAt: launch.completedAt,
    createdAt: launch.createdAt,
    updatedAt: launch.updatedAt,
    variants: launch.variants,
    goalIds: launch.goalIds,
  };
}

export function serializeVariant(variant: Variant) {
  return {
    id: variant.id,
    launchId: variant.launchId,
    label: variant.label,
    variantType: variant.variantType,
    body: variant.body,
    contentItemId: variant.contentItemId,
    status: variant.status,
    predictedScore: variant.predictedScore,
    predictionConfidence: variant.predictionConfidence,
    predictedMetrics: parseJsonRecord(variant.predictedMetrics),
    predictionModel: variant.predictionModel,
    simulatedAt: variant.simulatedAt,
    generationModel: variant.generationModel,
    generationMetadata: parseJsonRecord(variant.generationMetadata),
    metadata: parseJsonRecord(variant.metadata),
    createdAt: variant.createdAt,
    updatedAt: variant.updatedAt,
  };
}

type SimulationRunDetail = NonNullable<ReturnType<typeof getSimulationRun>>;

export function serializeSimulationRun(
  run: SimulationRunDetail | (SimulationRunDetail & { agents?: SimulationRunDetail["agents"] }),
  opts?: {
    includeAgents?: boolean;
    includeTranscripts?: boolean;
    includeCalibrations?: boolean;
  },
) {
  const agents =
    opts?.includeAgents && run.agents
      ? run.agents.map((agent) => ({
          id: agent.id,
          contactId: agent.contactId,
          orgId: agent.orgId,
          contactPersonaId: agent.contactPersonaId,
          grounding: agent.grounding,
          engagementScore: agent.engagementScore,
          outcome: agent.outcome,
          predictedActions: agent.predictedActions,
          ...(opts?.includeTranscripts && agent.transcript ? { transcript: agent.transcript } : {}),
        }))
      : undefined;

  return {
    id: run.id,
    variantId: run.variantId,
    batchId: run.batchId,
    status: run.status,
    agentCount: run.agentCount,
    predictionModel: run.predictionModel,
    predictedScore: run.predictedScore,
    predictionConfidence: run.predictionConfidence,
    predictedMetrics: parseJsonRecord(run.predictedMetrics),
    populationSpec: parseJsonRecord(run.populationSpec),
    error: run.error,
    workflowRunId: run.workflowRunId,
    scope: run.scope,
    source: run.source,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    transcriptsPrunedAt: run.transcriptsPrunedAt,
    ...(agents ? { agents } : {}),
    ...(opts?.includeCalibrations && "latestCalibration" in run && run.latestCalibration
      ? { latestCalibration: run.latestCalibration }
      : {}),
  };
}
