import { listOrgs } from "@/lib/db/queries/orgs";
import { listOrgIdentities, upsertOrgIdentity } from "@/lib/db/queries/org-identities";
import { listLaunches, upsertLaunch } from "@/lib/db/queries/launches";
import { listNiches, upsertNiche } from "@/lib/db/queries/niches";
import { semanticSearch } from "@/lib/db/queries/embeddings";
import { getVariantById, upsertVariant } from "@/lib/db/queries/variants";
import {
  createAndStartSimulationRun,
  completeSimulationRun,
  getSimulationRun,
  listSimulationRuns,
  recordSimulationAgentResults,
} from "@/lib/db/queries/simulations";
import { getNeighbors, upsertGraphEdge } from "@/lib/db/queries/graph";
import { logInteraction } from "@/lib/db/queries/interactions";
import { getNodeDisplayLabel } from "@/lib/embeddings/node-labels";
import { EmbeddingUnavailableError } from "@/lib/embeddings/embed-node";
import { rtxEmbed } from "@/lib/rtx/llm";
import type {
  logInteractionSchema,
  queryGraphSchema,
  queryLaunchesSchema,
  queryNichesSchema,
  queryOrgsSchema,
  queryOrgIdentitiesSchema,
  semanticSearchSchema,
  upsertOrgIdentitySchema,
  upsertEdgeSchema,
  upsertLaunchSchema,
  upsertNicheSchema,
  upsertVariantSchema,
  createSimulationRunSchema,
  querySimulationsSchema,
  recordSimulationResultsSchema,
  completeSimulationRunSchema,
} from "@/lib/agent-tools/graph-schemas";
import type { z } from "zod";

export async function handleQueryOrgs(input: z.infer<typeof queryOrgsSchema>) {
  const result = listOrgs({
    search: input.search,
    page: input.page,
    pageSize: input.pageSize,
    includeLocalOnly: input.includeLocalOnly ?? false,
  });

  return {
    total: result.total,
    orgs: result.data.map((org) => ({
      id: org.id,
      name: org.name,
      orgType: org.orgType,
      domain: org.domain,
      scope: org.scope,
    })),
  };
}

export async function handleQueryGraph(input: z.infer<typeof queryGraphSchema>) {
  const includeLocalOnly = input.includeLocalOnly ?? false;
  const edges = getNeighbors(input.nodeType, input.nodeId, {
    edgeTypes: input.edgeTypes,
    direction: input.direction,
    includeLocalOnly,
  });

  return {
    nodeType: input.nodeType,
    nodeId: input.nodeId,
    edgeCount: edges.length,
    edges: edges.map((edge) => ({
      id: edge.id,
      edgeType: edge.edgeType,
      srcType: edge.srcType,
      srcId: edge.srcId,
      dstType: edge.dstType,
      dstId: edge.dstId,
      weight: edge.weight,
      properties: JSON.parse(edge.properties ?? "{}"),
      ...(includeLocalOnly && edge.propertiesPrivate
        ? { propertiesPrivate: JSON.parse(edge.propertiesPrivate) }
        : {}),
      scope: edge.scope,
    })),
  };
}

export async function handleUpsertEdge(input: z.infer<typeof upsertEdgeSchema>) {
  if (input.edgeType === "published_as") {
    throw new Error(
      "published_as edges are created only via upsert_variant publish flow; use upsert_variant with status published",
    );
  }

  const edge = upsertGraphEdge({
    srcType: input.srcType,
    srcId: input.srcId,
    dstType: input.dstType,
    dstId: input.dstId,
    edgeType: input.edgeType,
    weight: input.weight,
    properties: input.properties ? JSON.stringify(input.properties) : undefined,
    propertiesPrivate: input.propertiesPrivate
      ? JSON.stringify(input.propertiesPrivate)
      : undefined,
    scope: input.scope,
    source: input.source ?? "agent",
  });

  return {
    id: edge.id,
    edgeType: edge.edgeType,
    srcType: edge.srcType,
    srcId: edge.srcId,
    dstType: edge.dstType,
    dstId: edge.dstId,
    scope: edge.scope,
    message: "Graph edge upserted.",
  };
}

export async function handleLogInteraction(input: z.infer<typeof logInteractionSchema>) {
  const interaction = logInteraction({
    contactId: input.contactId,
    interactionType: input.interactionType,
    occurredAt: input.occurredAt,
    orgId: input.orgId,
    direction: input.direction,
    summary: input.summary,
    isMeaningful: input.isMeaningful,
    scope: input.scope,
    contentItemId: input.contentItemId,
    metadata: input.metadata,
    source: "agent",
  });

  return {
    id: interaction.id,
    contactId: interaction.contactId,
    interactionType: interaction.interactionType,
    occurredAt: interaction.occurredAt,
    scope: interaction.scope,
    message: "Interaction logged.",
  };
}

export async function handleQueryNiches(input: z.infer<typeof queryNichesSchema>) {
  const result = listNiches({
    search: input.search,
    status: input.status,
    page: input.page,
    pageSize: input.pageSize,
    includeLocalOnly: input.includeLocalOnly ?? false,
  });

  return {
    total: result.total,
    niches: result.data.map((niche) => ({
      id: niche.id,
      name: niche.name,
      slug: niche.slug,
      nicheType: niche.nicheType,
      status: niche.status,
      scope: niche.scope,
      memberCount: niche.memberCount,
    })),
  };
}

export async function handleUpsertNiche(input: z.infer<typeof upsertNicheSchema>) {
  const niche = upsertNiche({
    id: input.id,
    name: input.name,
    description: input.description,
    nicheType: input.nicheType,
    status: input.status,
    scope: input.scope,
    source: "agent",
    metadata: input.metadata,
  });

  return {
    id: niche.id,
    name: niche.name,
    slug: niche.slug,
    status: niche.status,
    scope: niche.scope,
    message: "Niche upserted.",
  };
}

export async function handleQueryLaunches(input: z.infer<typeof queryLaunchesSchema>) {
  const result = listLaunches({
    search: input.search,
    status: input.status,
    page: input.page,
    pageSize: input.pageSize,
    includeLocalOnly: input.includeLocalOnly ?? false,
  });

  return {
    total: result.total,
    launches: result.data.map((launch) => ({
      id: launch.id,
      name: launch.name,
      status: launch.status,
      primaryPlatform: launch.primaryPlatform,
      scope: launch.scope,
      variants: launch.variants,
      goalIds: launch.goalIds,
    })),
  };
}

export async function handleUpsertLaunch(input: z.infer<typeof upsertLaunchSchema>) {
  const launch = upsertLaunch({
    id: input.id,
    name: input.name,
    brief: input.brief,
    status: input.status,
    primaryPlatform: input.primaryPlatform,
    audienceSpec: input.audienceSpec,
    workflowTemplateId: input.workflowTemplateId,
    scope: input.scope,
    metadata: input.metadata,
    launchedAt: input.launchedAt,
    completedAt: input.completedAt,
  });

  return {
    id: launch.id,
    name: launch.name,
    status: launch.status,
    scope: launch.scope,
    message: "Launch upserted.",
  };
}

export async function handleUpsertVariant(input: z.infer<typeof upsertVariantSchema>) {
  const variant = upsertVariant({
    id: input.id,
    launchId: input.launchId,
    label: input.label,
    variantType: input.variantType,
    body: input.body,
    contentItemId: input.contentItemId,
    status: input.status,
    predictedScore: input.predictedScore,
    predictionConfidence: input.predictionConfidence,
    predictedMetrics: input.predictedMetrics,
    predictionModel: input.predictionModel,
    simulatedAt: input.simulatedAt,
    generationModel: input.generationModel,
    generationMetadata: input.generationMetadata,
    metadata: input.metadata,
    platform: input.platform,
    publishedAt: input.publishedAt,
  });

  return {
    id: variant.id,
    launchId: variant.launchId,
    status: variant.status,
    contentItemId: variant.contentItemId,
    message: "Variant upserted.",
  };
}

export async function handleSemanticSearch(input: z.infer<typeof semanticSearchSchema>) {
  const embedResult = await rtxEmbed([input.query]);
  if (!embedResult.success) {
    throw new EmbeddingUnavailableError(embedResult.code, embedResult.error);
  }

  const queryVector = embedResult.embeddings[0];
  if (!queryVector) {
    throw new EmbeddingUnavailableError("EMBED_ERROR", "RealtimeX returned no embedding vector.");
  }

  const kind = input.kind ?? "description";
  const hits = semanticSearch({
    nodeTypes: input.nodeTypes,
    kind,
    model: embedResult.qualifiedModel,
    queryVector,
    k: input.k,
    includeLocalOnly: input.includeLocalOnly ?? false,
  });

  return {
    model: embedResult.qualifiedModel,
    dimensions: embedResult.dimensions,
    kind,
    resultCount: hits.length,
    results: hits.map((hit) => ({
      nodeType: hit.nodeType,
      nodeId: hit.nodeId,
      score: hit.score,
      label: getNodeDisplayLabel(hit.nodeType, hit.nodeId),
    })),
  };
}

function serializeOrgIdentity(identity: Awaited<ReturnType<typeof upsertOrgIdentity>>) {
  return {
    id: identity.id,
    orgId: identity.orgId,
    platform: identity.platform,
    platformUserId: identity.platformUserId,
    platformHandle: identity.platformHandle,
    platformUrl: identity.platformUrl,
    displayName: identity.displayName,
    bio: identity.bio,
    avatarUrl: identity.avatarUrl,
    location: identity.location,
    websiteUrl: identity.websiteUrl,
    isVerified: identity.isVerified,
    followersCount: identity.followersCount,
    followingCount: identity.followingCount,
    postsCount: identity.postsCount,
    listedCount: identity.listedCount,
    platformCreatedAt: identity.platformCreatedAt,
    statsUpdatedAt: identity.statsUpdatedAt,
    isPrimary: Boolean(identity.isPrimary),
    isActive: Boolean(identity.isActive),
    lastSyncedAt: identity.lastSyncedAt,
  };
}

export async function handleQueryOrgIdentities(
  input: z.infer<typeof queryOrgIdentitiesSchema>,
) {
  const result = listOrgIdentities({
    orgId: input.orgId,
    platform: input.platform,
    page: input.page,
    pageSize: input.pageSize,
  });

  return {
    total: result.total,
    identities: result.data.map(serializeOrgIdentity),
  };
}

export async function handleUpsertOrgIdentity(input: z.infer<typeof upsertOrgIdentitySchema>) {
  const identity = upsertOrgIdentity({
    id: input.id,
    orgId: input.orgId,
    platform: input.platform,
    platformUserId: input.platformUserId,
    platformHandle: input.platformHandle,
    platformUrl: input.platformUrl,
    platformData: input.platformData ? JSON.stringify(input.platformData) : undefined,
    displayName: input.displayName,
    bio: input.bio,
    avatarUrl: input.avatarUrl,
    location: input.location,
    websiteUrl: input.websiteUrl,
    isVerified: input.isVerified,
    followersCount: input.followersCount,
    followingCount: input.followingCount,
    postsCount: input.postsCount,
    listedCount: input.listedCount,
    platformCreatedAt: input.platformCreatedAt,
    isPrimary: input.isPrimary === undefined ? undefined : input.isPrimary ? 1 : 0,
    isActive: input.isActive === undefined ? undefined : input.isActive ? 1 : 0,
    lastSyncedAt: input.lastSyncedAt,
  });

  return {
    ...serializeOrgIdentity(identity),
    message: "Org identity upserted.",
  };
}

function serializeSimulationRun(
  run: NonNullable<ReturnType<typeof getSimulationRun>>,
  opts?: { includeAgents?: boolean },
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
    predictedMetrics: JSON.parse(run.predictedMetrics ?? "{}") as Record<string, unknown>,
    scope: run.scope,
    source: run.source,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    ...(agents ? { agents } : {}),
  };
}

export async function handleCreateSimulationRun(
  input: z.infer<typeof createSimulationRunSchema>,
) {
  const { run, agents } = createAndStartSimulationRun({
    variantId: input.variantId,
    populationSpec: input.populationSpec,
    batchId: input.batchId,
    predictionModel: input.predictionModel,
    config: input.config,
    source: "agent",
  });

  return {
    run: serializeSimulationRun({ ...run, agents }, { includeAgents: true }),
    message: "Simulation run created and started.",
  };
}

export async function handleQuerySimulations(input: z.infer<typeof querySimulationsSchema>) {
  const result = listSimulationRuns({
    variantId: input.variantId,
    launchId: input.launchId,
    batchId: input.batchId,
    status: input.status,
    page: input.page,
    pageSize: input.pageSize,
  });

  const runs = result.data.map((run) => {
    if (input.includeAgents) {
      const detailed = getSimulationRun(run.id, { includeAgents: true });
      return detailed ? serializeSimulationRun(detailed, { includeAgents: true }) : serializeSimulationRun(run);
    }
    return serializeSimulationRun(run);
  });

  return {
    total: result.total,
    runs,
  };
}

export async function handleRecordSimulationResults(
  input: z.infer<typeof recordSimulationResultsSchema>,
) {
  recordSimulationAgentResults(input.runId, input.results);
  const run = getSimulationRun(input.runId, { includeAgents: true });
  if (!run) {
    throw new Error(`Simulation run not found: ${input.runId}`);
  }
  return {
    run: serializeSimulationRun(run, { includeAgents: true }),
    message: "Simulation agent results recorded.",
  };
}

export async function handleCompleteSimulationRun(
  input: z.infer<typeof completeSimulationRunSchema>,
) {
  const run = completeSimulationRun(input.runId, {
    status: input.status,
    predictedScore: input.predictedScore,
    predictionConfidence: input.predictionConfidence,
    predictedMetrics: input.predictedMetrics,
    error: input.error,
  });
  const variant = getVariantById(run.variantId);
  return {
    run: serializeSimulationRun(run),
    variant: variant
      ? {
          id: variant.id,
          predictedScore: variant.predictedScore,
          predictionConfidence: variant.predictionConfidence,
          predictedMetrics: JSON.parse(variant.predictedMetrics ?? "{}") as Record<string, unknown>,
          predictionModel: variant.predictionModel,
          simulatedAt: variant.simulatedAt,
          status: variant.status,
        }
      : null,
    message: "Simulation run completed.",
  };
}
