import {
  addOrgDomainAlias,
  createOrg,
  getOrgByDomain,
  getOrgById,
  getOrgDTO,
  listOrgs,
  recalcOrgEnrichment,
  updateOrg,
} from "@/lib/db/queries/orgs";
import { getContactById } from "@/lib/db/queries/contacts";
import { getOrgRelationshipSummary } from "@/lib/db/queries/org-relationships";
import { listOrgPeople } from "@/lib/db/queries/org-people";
import {
  createContactEmployment,
  deleteContactEmployment,
  updateContactEmployment,
} from "@/lib/db/queries/contact-employments";
import { logOrgActivity, listOrgTimeline } from "@/lib/db/queries/org-activities";
import {
  generateOrgEmailCandidates,
  getOrgEmailIntelligence,
  inferOrgEmailPatterns,
  setOrgEmailPattern,
} from "@/lib/contacts/email-patterns/intelligence";
import { updateEmailCandidate } from "@/lib/contacts/email-verification/candidates";
import { checkOrgMailDomains } from "@/lib/contacts/email-verification/mail-domains";
import { db } from "@/lib/db/client";
import { contactEmailCandidates, contactEmployments, orgs } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { listOrgIdentities, upsertOrgIdentity } from "@/lib/db/queries/org-identities";
import { listLaunches, toLaunchVariantSummary, upsertLaunch } from "@/lib/db/queries/launches";
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
import { logInteraction, countInteractionAttachments } from "@/lib/db/queries/interactions";
import { getNodeDisplayLabel } from "@/lib/embeddings/node-labels";
import { EmbeddingUnavailableError } from "@/lib/embeddings/embed-node";
import { rtxEmbed } from "@/lib/rtx/llm";
import type {
  logInteractionSchema,
  queryGraphSchema,
  queryLaunchesSchema,
  queryNichesSchema,
  queryOrgsSchema,
  getOrgSchema,
  createOrgSchema,
  updateOrgSchema,
  getOrgRelationshipsSchema,
  listOrgContactsSchema,
  linkContactToOrgSchema,
  unlinkContactFromOrgSchema,
  getOrgEmailIntelligenceSchema,
  inferOrgEmailPatternSchema,
  setOrgEmailPatternSchema,
  generateOrgEmailCandidatesSchema,
  listEmailCandidatesSchema,
  updateEmailCandidateSchema,
  addOrgDomainAliasSchema,
  logOrgActivitySchema,
  listOrgActivitySchema,
  followOrgSchema,
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
  calibrateSimulationRunSchema,
} from "@/lib/agent-tools/graph-schemas";
import { calibrateSimulationRun, serializeCalibration } from "@/lib/db/queries/calibrations";
import { serializeSimulationRun } from "@/lib/serializers/gtm";
import { AgentToolError } from "@/lib/agent-tools/types";
import { OrgDomainConflictError, OrgValidationError } from "@/lib/orgs/errors";
import { validateWorkflowRunAndTemplateIds } from "@/lib/db/creation-provenance-input";
import type { z } from "zod";

export async function handleQueryOrgs(input: z.infer<typeof queryOrgsSchema>) {
  const result = listOrgs({
    search: input.search,
    page: input.page,
    pageSize: input.pageSize,
    includeLocalOnly: input.includeLocalOnly ?? false,
    stage: input.stage,
    owner: input.owner,
    followed: input.followed,
    tag: input.tag,
  });

  return {
    total: result.total,
    orgs: result.data.map((org) => ({
      id: org.id,
      name: org.name,
      orgType: org.orgType,
      domain: org.domain,
      website: org.website,
      industry: org.industry,
      companySize: org.companySize,
      accountStage: org.accountStage,
      ownerContactId: org.ownerContactId,
      tags: (() => {
        try {
          const parsed: unknown = JSON.parse(org.tags ?? "[]");
          return Array.isArray(parsed) ? parsed.filter((tag): tag is string => typeof tag === "string") : [];
        } catch {
          return [];
        }
      })(),
      enrichmentScore: org.enrichmentScore,
      scope: org.scope,
    })),
  };
}

function requireOrg(orgId: string) {
  const org = getOrgById(orgId);
  if (!org) throw new AgentToolError("NOT_FOUND", "Company not found");
  return org;
}

export async function handleGetOrgRelationships(
  input: z.infer<typeof getOrgRelationshipsSchema>,
) {
  requireOrg(input.orgId);
  return getOrgRelationshipSummary(input.orgId, {
    includeLocalOnly: input.includeLocalOnly ?? false,
  });
}

export async function handleListOrgContacts(input: z.infer<typeof listOrgContactsSchema>) {
  requireOrg(input.orgId);
  const result = listOrgPeople(input.orgId, {
    q: input.q,
    employment: input.employment,
    band: input.band,
    sort: input.sort,
    dir: input.dir,
    page: input.page,
    pageSize: input.pageSize,
    includeLocalOnly: input.includeLocalOnly ?? false,
  });
  return { total: result.total, people: result.data };
}

export async function handleLinkContactToOrg(input: z.infer<typeof linkContactToOrgSchema>) {
  requireOrg(input.orgId);
  if (!getContactById(input.contactId)) throw new AgentToolError("NOT_FOUND", "Contact not found");
  const current = db.select().from(contactEmployments).where(and(
    eq(contactEmployments.orgId, input.orgId),
    eq(contactEmployments.contactId, input.contactId),
    eq(contactEmployments.isCurrent, true),
  )).get();
  if (current && (input.isCurrent ?? true)) {
    throw new AgentToolError("CONFLICT", "A current employment already exists");
  }
  const employment = createContactEmployment({
    contactId: input.contactId,
    orgId: input.orgId,
    title: input.title,
    isCurrent: input.isCurrent ?? true,
    startedAt: input.startedAt,
    source: "agent:link_contact_to_org",
  });
  recalcOrgEnrichment(input.orgId);
  logOrgActivity({
    orgId: input.orgId,
    contactId: input.contactId,
    activityType: "contact_linked",
    title: "Person linked to company",
    source: "agent:link_contact_to_org",
    dedupeKey: `contact_linked:${employment.id}`,
  });
  return { employment, message: "Contact linked to company." };
}

export async function handleUnlinkContactFromOrg(
  input: z.infer<typeof unlinkContactFromOrgSchema>,
) {
  requireOrg(input.orgId);
  const rows = db.select().from(contactEmployments).where(and(
    eq(contactEmployments.orgId, input.orgId),
    eq(contactEmployments.contactId, input.contactId),
  )).all();
  if (!rows.length) throw new AgentToolError("NOT_FOUND", "Employment not found");
  const mode = input.mode ?? "remove";
  if (mode === "mark_former") {
    const endedAt = Math.floor(Date.now() / 1000);
    for (const row of rows.filter((row) => row.isCurrent)) {
      updateContactEmployment(row.id, { isCurrent: false, endedAt });
    }
  } else {
    for (const row of rows) deleteContactEmployment(row.id);
  }
  recalcOrgEnrichment(input.orgId);
  logOrgActivity({
    orgId: input.orgId,
    contactId: input.contactId,
    activityType: "contact_unlinked",
    title: mode === "mark_former" ? "Person marked as former" : "Person unlinked from company",
    source: "agent:unlink_contact_from_org",
    dedupeKey: `contact_unlinked:${input.orgId}:${input.contactId}:${Date.now()}`,
  });
  return { orgId: input.orgId, contactId: input.contactId, mode, message: "Company link updated." };
}

export async function handleGetOrgEmailIntelligence(
  input: z.infer<typeof getOrgEmailIntelligenceSchema>,
) {
  requireOrg(input.orgId);
  return getOrgEmailIntelligence(input.orgId);
}

export async function handleInferOrgEmailPattern(
  input: z.infer<typeof inferOrgEmailPatternSchema>,
) {
  requireOrg(input.orgId);
  const result = inferOrgEmailPatterns(input.orgId);
  if (input.checkMail && result.canInfer) await checkOrgMailDomains(input.orgId);
  return result.canInfer ? getOrgEmailIntelligence(input.orgId) : result;
}

export async function handleSetOrgEmailPattern(input: z.infer<typeof setOrgEmailPatternSchema>) {
  requireOrg(input.orgId);
  try {
    return setOrgEmailPattern(input.orgId, {
      pattern: input.pattern,
      clear: input.clear,
      evidenceUrl: input.evidenceUrl,
      source: input.evidenceUrl ? "agent:evidence" : "agent:override",
    });
  } catch (error) {
    throw new AgentToolError(
      "VALIDATION_ERROR",
      error instanceof Error ? error.message : "Invalid email pattern",
    );
  }
}

export async function handleGenerateOrgEmailCandidates(
  input: z.infer<typeof generateOrgEmailCandidatesSchema>,
) {
  requireOrg(input.orgId);
  return generateOrgEmailCandidates(input.orgId, { contactIds: input.contactIds });
}

export async function handleListEmailCandidates(input: z.infer<typeof listEmailCandidatesSchema>) {
  const data = db.select().from(contactEmailCandidates).where(and(
    input.orgId ? eq(contactEmailCandidates.orgId, input.orgId) : undefined,
    input.contactId ? eq(contactEmailCandidates.contactId, input.contactId) : undefined,
    input.status ? eq(contactEmailCandidates.status, input.status) : undefined,
  )).all();
  return { data, total: data.length };
}

export async function handleUpdateEmailCandidate(
  input: z.infer<typeof updateEmailCandidateSchema>,
) {
  try {
    const candidate = updateEmailCandidate(input.candidateId, {
      action: input.action,
      address: input.address,
      evidenceUrl: input.evidenceUrl,
      note: input.note,
      actor: "agent",
    });
    if (!candidate) throw new AgentToolError("NOT_FOUND", "Email candidate not found");
    return candidate;
  } catch (error) {
    if (error instanceof AgentToolError) throw error;
    throw new AgentToolError("CONFLICT", error instanceof Error ? error.message : "Candidate update failed");
  }
}

export async function handleAddOrgDomainAlias(input: z.infer<typeof addOrgDomainAliasSchema>) {
  requireOrg(input.orgId);
  try {
    return addOrgDomainAlias(input.orgId, input.domain, "agent:add_org_domain_alias");
  } catch (error) {
    if (error instanceof OrgValidationError) {
      throw new AgentToolError("VALIDATION_ERROR", error.message, error.details);
    }
    if (error instanceof OrgDomainConflictError) {
      throw new AgentToolError("CONFLICT", error.message, { domain: error.domain, orgId: error.orgId });
    }
    throw error;
  }
}

export async function handleLogOrgActivity(input: z.infer<typeof logOrgActivitySchema>) {
  requireOrg(input.orgId);
  return logOrgActivity({ ...input, source: "agent:signal_scan" });
}

export async function handleListOrgActivity(input: z.infer<typeof listOrgActivitySchema>) {
  requireOrg(input.orgId);
  return listOrgTimeline(input.orgId, {
    category: input.category,
    types: input.types,
    since: input.since,
    page: input.page,
    pageSize: input.pageSize,
    includeLocalOnly: input.includeLocalOnly ?? false,
  });
}

export async function handleFollowOrg(input: z.infer<typeof followOrgSchema>) {
  requireOrg(input.orgId);
  const now = Math.floor(Date.now() / 1000);
  const followedAt = input.follow ? now : null;
  db.update(orgs).set({ followedAt, updatedAt: now }).where(eq(orgs.id, input.orgId)).run();
  logOrgActivity({
    orgId: input.orgId,
    activityType: input.follow ? "followed" : "unfollowed",
    title: input.follow ? "Company followed" : "Company unfollowed",
    source: "agent:follow_org",
    dedupeKey: `${input.follow ? "followed" : "unfollowed"}:${input.orgId}:${now}`,
  });
  return { followedAt };
}

export async function handleGetOrg(input: z.infer<typeof getOrgSchema>) {
  try {
    const id = input.orgId ?? (input.domain ? getOrgByDomain(input.domain)?.id : undefined);
    const org = id ? getOrgDTO(id) : undefined;
    if (!org) throw new AgentToolError("NOT_FOUND", "Company not found");
    return org;
  } catch (error) {
    if (error instanceof OrgValidationError) {
      throw new AgentToolError("VALIDATION_ERROR", error.message, error.details);
    }
    throw error;
  }
}

export async function handleCreateOrg(input: z.infer<typeof createOrgSchema>) {
  try {
    const resolvedIds = validateWorkflowRunAndTemplateIds({
      workflowRunId: input.workflowRunId,
      templateId: input.templateId,
    });
    const org = createOrg({
      name: input.name,
      orgType: input.orgType,
      domain: input.domain,
      website: input.website,
      description: input.description,
      location: input.location,
      avatarUrl: input.avatarUrl,
      industry: input.industry,
      companySize: input.companySize,
      tags: input.tags,
      ownerContactId: input.ownerContactId,
      accountStage: input.accountStage,
      source: "agent",
      provenance: {
        tag: "agent:create_org",
        workflowRunId: resolvedIds.workflowRunId,
        templateId: resolvedIds.templateId,
      },
    });
    return getOrgDTO(org.id)!;
  } catch (error) {
    if (error instanceof OrgValidationError) {
      throw new AgentToolError("VALIDATION_ERROR", error.message, error.details);
    }
    if (error instanceof OrgDomainConflictError) {
      throw new AgentToolError("CONFLICT", error.message, {
        domain: error.domain,
        orgId: error.orgId,
      });
    }
    throw error;
  }
}

export async function handleUpdateOrg(input: z.infer<typeof updateOrgSchema>) {
  const { orgId, workflowRunId, fieldSources, ...patch } = input;
  const fieldsUpdated = Object.entries(patch)
    .filter(([, value]) => value !== undefined)
    .map(([field]) => field);
  try {
    const updated = updateOrg(orgId, patch, {
      source: "agent",
      tag: workflowRunId ? "agent:enrich_org" : "agent:update_org",
      workflowRunId,
      fieldSources,
    });
    if (!updated) throw new AgentToolError("NOT_FOUND", "Company not found");
    return { org: getOrgDTO(orgId)!, fieldsUpdated };
  } catch (error) {
    if (error instanceof OrgValidationError) {
      throw new AgentToolError("VALIDATION_ERROR", error.message, error.details);
    }
    if (error instanceof OrgDomainConflictError) {
      throw new AgentToolError("CONFLICT", error.message, {
        domain: error.domain,
        orgId: error.orgId,
      });
    }
    throw error;
  }
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
    attachmentIds: input.attachmentIds,
    metadata: input.metadata,
    source: "agent",
  });

  return {
    id: interaction.id,
    contactId: interaction.contactId,
    interactionType: interaction.interactionType,
    occurredAt: interaction.occurredAt,
    scope: interaction.scope,
    attachmentCount: countInteractionAttachments(interaction.id),
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
      variants: launch.variants.map(toLaunchVariantSummary),
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
    const detailOpts = {
      includeAgents: Boolean(input.includeAgents || input.includeTranscripts),
      includeTranscripts: input.includeTranscripts,
      includeCalibration: input.includeCalibrations,
    };
    if (detailOpts.includeAgents || input.includeCalibrations) {
      const detailed = getSimulationRun(run.id, detailOpts);
      return detailed
        ? serializeSimulationRun(detailed, {
            includeAgents: detailOpts.includeAgents,
            includeTranscripts: input.includeTranscripts,
            includeCalibrations: input.includeCalibrations,
          })
        : serializeSimulationRun(run);
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

export async function handleCalibrateSimulationRun(
  input: z.infer<typeof calibrateSimulationRunSchema>,
) {
  const calibration = calibrateSimulationRun(input.runId, {
    observedUntil: input.observedUntil,
    provenance: { source: "agent" },
  });
  return {
    calibration: serializeCalibration(calibration),
    message: "Simulation run calibrated.",
  };
}
