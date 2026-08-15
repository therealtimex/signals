import { listOrgs } from "@/lib/db/queries/orgs";
import { listLaunches, upsertLaunch } from "@/lib/db/queries/launches";
import { listNiches, upsertNiche } from "@/lib/db/queries/niches";
import { upsertVariant } from "@/lib/db/queries/variants";
import { getNeighbors, upsertGraphEdge } from "@/lib/db/queries/graph";
import { logInteraction } from "@/lib/db/queries/interactions";
import type {
  logInteractionSchema,
  queryGraphSchema,
  queryLaunchesSchema,
  queryNichesSchema,
  queryOrgsSchema,
  upsertEdgeSchema,
  upsertLaunchSchema,
  upsertNicheSchema,
  upsertVariantSchema,
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
