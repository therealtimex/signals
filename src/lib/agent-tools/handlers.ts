import { listContacts, getContactById, createContact, updateContact, recalcEnrichment } from "@/lib/db/queries/contacts";
import { createIdentity, getIdentityById, updateIdentity } from "@/lib/db/queries/identities";
import { resolvePlatformClaim } from "@/lib/db/identity-claims";
import { getDashboardMetrics } from "@/lib/db/queries/dashboard";
import { getWorkflowRun, listWorkflowRuns, updateWorkflowRun } from "@/lib/db/queries/workflows";
import { listTemplates } from "@/lib/db/queries/workflow-templates";
import { listContentItems } from "@/lib/db/queries/content";
import { listGoals } from "@/lib/db/queries/goals";
import { createTask } from "@/lib/db/queries/tasks";
import { getActivePersona, upsertPersona } from "@/lib/db/queries/personas";
import { assemblePersonaEvidence } from "@/lib/db/queries/persona-evidence";
import { generatePersona } from "@/lib/workflows/generate-persona";
import {
  AGENT_ORCHESTRATION_MESSAGE,
  startAgentWorkflow,
} from "@/lib/agents/run-agent-workflow";
import { enrichContact } from "@/lib/agents/tools/enrich-contact";
import { archiveContactTool } from "@/lib/agents/tools/archive-contact";
import { findDuplicateContacts } from "@/lib/contacts/dedupe/detect";
import { MergeContactsError, mergeContacts } from "@/lib/contacts/dedupe/merge";
import { personNameKey, orgNameKey } from "@/lib/contacts/dedupe/normalize";
import { dispatchWorkflowCascade } from "@/lib/workflows/chaining";
import { emitWorkflowCompletedEvent } from "@/lib/webhooks/workflow-events";
import { runTemplateViaRtx, getRtxRuntimeSessionIdFromRunConfig } from "@/lib/agents/run-template-via-rtx";
import { isRtxEmbedded } from "@/lib/rtx/env";
import { getOrCreateOrchestratorThread } from "@/lib/rtx/orchestrator-thread";
import { resolveActiveTerminalSessionIdForThread } from "@/lib/rtx/runtime-sessions";
import {
  formatDeferredTerminalTeardownNote,
  scheduleTerminalSessionRelease,
  scheduleWorkflowTerminalSessionRelease,
  stopRunningRtxBrowserSessions,
} from "@/lib/rtx/resource-teardown";
import type { WorkflowType } from "@/lib/workflows/types";
import type {
  archiveContactSchema,
  findDuplicateContactsSchema,
  mergeContactsSchema,
  createContactSchema,
  createTaskSchema,
  enrichContactSchema,
  getContactSchema,
  listWorkflowTemplatesSchema,
  queryAnalyticsSchema,
  queryContactsSchema,
  resolvePlatformClaimSchema,
  queryContentSchema,
  queryGoalsSchema,
  queryWorkflowsSchema,
  startWorkflowSchema,
  dispatchFollowOnWorkflowSchema,
  completeWorkflowRunSchema,
  recordWorkflowRunContactsSchema,
  updateContactSchema,
  getPersonaSchema,
  getPersonaEvidenceSchema,
  generatePersonaSchema,
  upsertPersonaSchema,
  upsertContactIdentitySchema,
} from "@/lib/agent-tools/schemas";
import type { z } from "zod";
import type { ContactIdentity } from "@/lib/db/types";
import { assertPlatform } from "@/lib/db/platforms";
import { validateIdentityAvatarUrl } from "@/lib/contact-avatar-client";
import { validateWorkflowRunAndTemplateIds } from "@/lib/db/creation-provenance-input";
import { CreatedSourceDetailFilterError } from "@/lib/db/creation-sources";
import { AgentToolError } from "@/lib/agent-tools/types";
import { listContactEmailCandidates } from "@/lib/contacts/email-verification/candidates";
import {
  recordRunCohort,
  resolveRunCohort,
  RunCohortError,
} from "@/lib/workflows/run-cohort";

const DEFAULT_PAGE_SIZE = 20;

function platformClaimConflict(
  platform: string,
  platformUserId: string,
  claimant:
    | { kind: "contact"; contactId: string; identityId: string; archived: boolean }
    | { kind: "org"; orgId: string; identityId: string },
): AgentToolError {
  const ownerId = claimant.kind === "contact" ? claimant.contactId : claimant.orgId;
  return new AgentToolError(
    "CONFLICT",
    `Platform account ${platform}:${platformUserId} is already claimed by ${claimant.kind} ${ownerId}. Reassign, don't duplicate.`,
    { platform, platformUserId, claimant },
  );
}

function serializeContactBirthFields(contact: {
  createdSource: string | null;
  createdSourceDetail: string | null;
  createdWorkflowRunId: string | null;
  createdTemplateId: string | null;
}) {
  return {
    createdSource: contact.createdSource,
    createdSourceDetail: contact.createdSourceDetail,
    createdWorkflowRunId: contact.createdWorkflowRunId,
    createdTemplateId: contact.createdTemplateId,
  };
}

function primaryPlatform(
  identities: { platform: string; isPrimary: number | boolean }[],
): string | null {
  const primary = identities.find((id) => id.isPrimary);
  return primary?.platform ?? identities[0]?.platform ?? null;
}

/** Compact identity ref for list payloads: enough to resolve a platform claim. */
function serializeContactIdentityRef(identity: {
  platform: string;
  platformUserId: string;
  platformHandle: string | null;
  isPrimary: number | boolean;
}) {
  return {
    platform: identity.platform,
    platformUserId: identity.platformUserId,
    handle: identity.platformHandle,
    isPrimary: Boolean(identity.isPrimary),
  };
}

function serializeContactIdentity(identity: ContactIdentity) {
  return {
    id: identity.id,
    platform: identity.platform,
    platformUserId: identity.platformUserId,
    handle: identity.platformHandle,
    profileUrl: identity.platformUrl,
    displayName: identity.displayName,
    headline: identity.headline,
    avatarUrl: identity.avatarUrl,
    bio: identity.bio,
    location: identity.location,
    websiteUrl: identity.websiteUrl,
    isVerified: identity.isVerified,
    followersCount: identity.followersCount,
    isPrimary: Boolean(identity.isPrimary),
    isActive: Boolean(identity.isActive),
  };
}

export async function handleQueryContacts(input: z.infer<typeof queryContactsSchema>) {
  try {
    const result = listContacts({
      search: input.search,
      email: input.email,
      funnelStage: input.funnelStage,
      relationshipGoal: input.relationshipGoal,
      relationshipGoalStatus: input.relationshipGoalStatus,
      platform: input.platform,
      platformUserId: input.platformUserId,
      page: input.page,
      pageSize: input.pageSize ?? DEFAULT_PAGE_SIZE,
      sort: input.sort,
      order: input.order,
      createdSource: input.createdSource,
      createdSourceDetail: input.createdSourceDetail,
      createdWorkflowRunId: input.createdWorkflowRunId,
      createdTemplateId: input.createdTemplateId,
      minEnrichmentScore: input.minEnrichmentScore,
      maxEnrichmentScore: input.maxEnrichmentScore,
    });

    return {
      total: result.total,
      contacts: result.data.map((c) => ({
        id: c.id,
        name: c.name,
        company: c.company,
        title: c.title,
        email: c.email,
        primaryEmail: c.primaryEmail,
        channelCount: c.channelCount,
        score: c.enrichmentScore,
        stage: c.funnelStage,
        relationshipGoal: c.relationshipGoal,
        relationshipGoalStatus: c.relationshipGoalStatus,
        platform: primaryPlatform(c.identities),
        identityCount: c.identities.length,
        identities: c.identities.map(serializeContactIdentityRef),
        resolvedAvatarUrl: c.resolvedAvatarUrl,
        emailCandidates: listContactEmailCandidates(c.id),
        ...serializeContactBirthFields(c),
      })),
    };
  } catch (error) {
    if (error instanceof CreatedSourceDetailFilterError) {
      throw new AgentToolError("VALIDATION_ERROR", error.message);
    }
    throw error;
  }
}

export async function handleResolvePlatformClaim(
  input: z.infer<typeof resolvePlatformClaimSchema>,
) {
  const claim = resolvePlatformClaim(assertPlatform(input.platform), input.platformUserId);
  if (!claim.claimed) return { claimed: false };
  return { claimed: true, claimant: claim.claimant };
}

export async function handleGetContact(input: z.infer<typeof getContactSchema>) {
  const contact = getContactById(input.contactId);
  if (!contact) {
    return { error: `Contact not found: ${input.contactId}` };
  }

  return {
    id: contact.id,
    name: contact.name,
    firstName: contact.firstName,
    lastName: contact.lastName,
    email: contact.email,
    primaryEmail: contact.primaryEmail,
    primaryPhone: contact.primaryPhone,
    channelCount: contact.channelCount,
    channels: contact.channels.map((ch) => ({
      channelType: ch.channelType,
      value: ch.value,
      isPrimary: ch.isPrimary,
      isVerified: ch.isVerified,
    })),
    employments: contact.employments.map((employment) => ({
      orgId: employment.orgId,
      orgName: employment.orgName,
      title: employment.title,
      isCurrent: employment.isCurrent,
    })),
    currentEmployment: contact.currentEmployment,
    company: contact.company,
    title: contact.title,
    headline: contact.headline,
    bio: contact.bio,
    location: contact.location,
    website: contact.website,
    resolvedAvatarUrl: contact.resolvedAvatarUrl,
    platform: primaryPlatform(contact.identities),
    funnelStage: contact.funnelStage,
    relationshipGoal: contact.relationshipGoal,
    relationshipGoalStatus: contact.relationshipGoalStatus,
    relationshipGoalUpdatedAt: contact.relationshipGoalUpdatedAt,
    enrichmentScore: contact.enrichmentScore,
    tags: contact.tags,
    identities: contact.identities.map(serializeContactIdentity),
    emailCandidates: listContactEmailCandidates(contact.id),
    ...serializeContactBirthFields(contact),
  };
}

function isContactArchived(contact: { metadata?: string | null }): boolean {
  if (!contact.metadata) return false;
  try {
    const meta = JSON.parse(contact.metadata);
    return meta.archived === 1 || meta.archived === true;
  } catch {
    return false;
  }
}

function findMatchingExistingContact(
  input: z.infer<typeof createContactSchema>
): ReturnType<typeof getContactById> | undefined {
  // 1. By platform identity claim
  if (input.platform) {
    const p = assertPlatform(input.platform);
    const userIdOrHandle = (input.platformUserId || input.platformHandle || "").trim().replace(/^@/, "");
    if (userIdOrHandle) {
      const claim = resolvePlatformClaim(p, userIdOrHandle);
      if (claim.claimed && claim.claimant.kind === "contact") {
        const contact = getContactById(claim.claimant.contactId);
        if (contact && !isContactArchived(contact)) {
          return contact;
        }
      }
    }
  }

  // Also check channels for platform matches
  if (input.channels) {
    for (const ch of input.channels) {
      const p = ch.channelType;
      if (p === "x" || p === "linkedin" || p === "gmail" || p === "substack" || p === "instagram" || p === "facebook" || p === "threads" || p === "tiktok" || p === "youtube" || p === "bluesky" || p === "telegram" || p === "whatsapp") {
        const val = ch.value?.trim().replace(/^@/, "");
        if (val) {
          try {
            const claim = resolvePlatformClaim(assertPlatform(p), val);
            if (claim.claimed && claim.claimant.kind === "contact") {
              const contact = getContactById(claim.claimant.contactId);
              if (contact && !isContactArchived(contact)) {
                return contact;
              }
            }
          } catch {
            // Ignore non-standard platform names
          }
        }
      }
    }
  }

  // 2. By email
  const email = input.email?.trim() || input.channels?.find((ch) => ch.channelType === "email")?.value?.trim();
  if (email && email.includes("@")) {
    const matches = listContacts({ email });
    const match = matches.data.find((c) => !isContactArchived(c));
    if (match) {
      return getContactById(match.id);
    }
  }

  // 3. By exact normalized name + company
  if (input.name && input.company) {
    const normName = personNameKey(input.name);
    const normCompany = orgNameKey(input.company);
    if (normName && normCompany) {
      const candidates = listContacts({ search: input.name, pageSize: 50 });
      for (const cand of candidates.data) {
        if (isContactArchived(cand)) continue;
        if (personNameKey(cand.name) === normName) {
          const candCompany = cand.company || cand.currentEmployment?.orgName;
          if (candCompany && orgNameKey(candCompany) === normCompany) {
            return getContactById(cand.id);
          }
        }
      }
    }
  }

  return undefined;
}

export async function handleCreateContact(input: z.infer<typeof createContactSchema>) {
  const { workflowRunId, templateId, ...rest } = input;
  let resolvedIds: { workflowRunId: string | null; templateId: string | null };
  try {
    resolvedIds = validateWorkflowRunAndTemplateIds({ workflowRunId, templateId });
  } catch (error) {
    throw new AgentToolError(
      "VALIDATION_ERROR",
      error instanceof Error ? error.message : "Invalid workflow context",
    );
  }

  if (rest.platform && (rest.platformUserId || rest.platformHandle)) {
    const platform = assertPlatform(rest.platform);
    const platformUserId = (rest.platformUserId ?? rest.platformHandle ?? "")
      .trim()
      .replace(/^@/, "");
    try {
      validateIdentityAvatarUrl(rest.avatarUrl);
    } catch (error) {
      throw new AgentToolError(
        "VALIDATION_ERROR",
        error instanceof Error ? error.message : "Invalid avatarUrl",
      );
    }
    const claim = resolvePlatformClaim(platform, platformUserId);
    if (
      claim.claimed &&
      (claim.claimant.kind === "org" || claim.claimant.archived)
    ) {
      throw platformClaimConflict(platform, platformUserId, claim.claimant);
    }
  }

  // Auto-deduplication check: enrich existing contact if found
  const existing = findMatchingExistingContact(input);
  if (existing) {
    const enrichData: Record<string, unknown> = {};
    if (rest.company && !existing.company) enrichData.company = rest.company;
    if (rest.title && !existing.title) enrichData.title = rest.title;
    if (rest.headline && !existing.headline) enrichData.headline = rest.headline;
    if (rest.bio && !existing.bio) enrichData.bio = rest.bio;
    if (rest.location && !existing.location) enrichData.location = rest.location;
    if (rest.website && !existing.website) enrichData.website = rest.website;
    if (rest.notes) enrichData.metadata = { notes: rest.notes };
    if (Object.keys(enrichData).length > 0) {
      enrichContact(existing.id, enrichData);
    }

    if (existing.identities && existing.identities.length > 0 && (rest.headline || rest.bio || rest.location || rest.website || rest.avatarUrl)) {
      const primaryIdent = existing.identities.find((i) => i.isPrimary) ?? existing.identities[0];
      if (primaryIdent) {
        const patch: Record<string, unknown> = {};
        if (rest.headline && !primaryIdent.headline) patch.headline = rest.headline;
        if (rest.bio && !primaryIdent.bio) patch.bio = rest.bio;
        if (rest.location && !primaryIdent.location) patch.location = rest.location;
        if (rest.website && !primaryIdent.websiteUrl) patch.websiteUrl = rest.website;
        if (rest.avatarUrl && !primaryIdent.avatarUrl) patch.avatarUrl = rest.avatarUrl;
        if (Object.keys(patch).length > 0) {
          updateIdentity(primaryIdent.id, patch);
        }
      }
    }

    if (rest.platform && (rest.platformUserId || rest.platformHandle)) {
      await handleUpsertContactIdentity({
        contactId: existing.id,
        platform: rest.platform,
        platformUserId: rest.platformUserId ?? rest.platformHandle,
        platformHandle: rest.platformHandle,
        platformUrl: rest.platformUrl,
        avatarUrl: rest.avatarUrl,
      });
    }

    recalcEnrichment(existing.id);
    const updated = getContactById(existing.id) ?? existing;

    return {
      id: updated.id,
      name: updated.name,
      email: updated.email,
      company: updated.company,
      currentEmployment: updated.currentEmployment,
      enrichmentScore: updated.enrichmentScore,
      isExisting: true,
      message: `Contact "${updated.name}" already exists (${updated.id}); enriched existing record.`,
      ...serializeContactBirthFields(updated),
    };
  }

  const payload: Parameters<typeof createContact>[0] = {
    name: rest.name,
    firstName: rest.firstName,
    lastName: rest.lastName,
    funnelStage: rest.funnelStage ?? "prospect",
    relationshipGoal: rest.relationshipGoal,
    relationshipGoalStatus: rest.relationshipGoalStatus,
    headline: rest.headline,
    bio: rest.bio,
    location: rest.location,
    website: rest.website,
    avatarUrl: rest.avatarUrl,
  };

  if (rest.email !== undefined) payload.email = rest.email || null;
  if (rest.phone !== undefined) payload.phone = rest.phone ?? null;
  if (rest.channels !== undefined) payload.channels = rest.channels;

  if (rest.employments !== undefined) {
    payload.employments = rest.employments;
  } else {
    if (rest.company !== undefined) payload.company = rest.company ?? null;
    if (rest.title !== undefined) payload.title = rest.title ?? null;
  }

  const contact = createContact(payload, {
    tag: "agent:create_contact",
    workflowRunId: resolvedIds.workflowRunId,
    templateId: resolvedIds.templateId,
  });

  if (rest.platform && (rest.platformUserId || rest.platformHandle)) {
    await handleUpsertContactIdentity({
      contactId: contact.id,
      platform: rest.platform,
      platformUserId: rest.platformUserId ?? rest.platformHandle,
      platformHandle: rest.platformHandle,
      platformUrl: rest.platformUrl,
      avatarUrl: rest.avatarUrl,
    });
  }

  if (rest.notes) {
    enrichContact(contact.id, { metadata: { notes: rest.notes } });
  }

  recalcEnrichment(contact.id);
  const result = getContactById(contact.id) ?? contact;

  return {
    id: result.id,
    name: result.name,
    email: result.email,
    company: result.company,
    currentEmployment: result.currentEmployment,
    enrichmentScore: result.enrichmentScore,
    relationshipGoal: result.relationshipGoal,
    relationshipGoalStatus: result.relationshipGoalStatus,
    isExisting: false,
    message: `Contact "${result.name}" created successfully.`,
    ...serializeContactBirthFields(result),
  };
}

export async function handleUpdateContact(input: z.infer<typeof updateContactSchema>) {
  const { contactId, ...fields } = input;
  const existing = getContactById(contactId);
  if (!existing) {
    return { error: `Contact not found: ${contactId}` };
  }

  const updates: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    if (key === "is_self") {
      updates.isSelf = value;
      continue;
    }
    updates[key] = value;
  }

  const updated = updateContact(contactId, updates, "agent:update_contact");
  if (!updated) {
    return { error: `Failed to update contact: ${contactId}` };
  }

  return {
    id: updated.id,
    name: updated.name,
    email: updated.email,
    company: updated.company,
    title: updated.title,
    currentEmployment: updated.currentEmployment,
    funnelStage: updated.funnelStage,
    relationshipGoal: updated.relationshipGoal,
    relationshipGoalStatus: updated.relationshipGoalStatus,
    enrichmentScore: updated.enrichmentScore,
    message: `Contact "${updated.name}" updated successfully.`,
  };
}

export async function handleEnrichContact(input: z.infer<typeof enrichContactSchema>) {
  const { contactId, ...data } = input;
  if (!getContactById(contactId)) {
    throw new AgentToolError("NOT_FOUND", `Contact not found: ${contactId}`);
  }
  return enrichContact(contactId, data);
}

export async function handleUpsertContactIdentity(
  input: z.infer<typeof upsertContactIdentitySchema>,
) {
  const contact = getContactById(input.contactId);
  if (!contact) {
    throw new AgentToolError("NOT_FOUND", `Contact not found: ${input.contactId}`);
  }

  let avatarUrl: string | undefined;
  try {
    avatarUrl = validateIdentityAvatarUrl(input.avatarUrl);
  } catch (error) {
    throw new AgentToolError(
      "VALIDATION_ERROR",
      error instanceof Error ? error.message : "Invalid avatarUrl",
    );
  }

  let platformUrl = input.platformUrl?.trim() || undefined;
  if (platformUrl && /pbs\.twimg\.com|media\.licdn\.com|avatars\.githubusercontent\.com|\.(png|jpe?g|webp|gif)(\?.*)?$/i.test(platformUrl)) {
    if (!avatarUrl) {
      avatarUrl = platformUrl;
    }
    platformUrl = undefined;
  }

  const sharedFields = {
    platformHandle: input.platformHandle,
    platformUrl,
    platformData: input.platformData ? JSON.stringify(input.platformData) : undefined,
    displayName: input.displayName,
    headline: input.headline,
    bio: input.bio,
    avatarUrl,
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
  };

  let identity: ContactIdentity | undefined;
  if (input.id) {
    const existing = getIdentityById(input.id);
    if (!existing || existing.contactId !== input.contactId) {
      throw new AgentToolError("NOT_FOUND", `Identity not found for contact: ${input.id}`);
    }

    const platform = input.platform ? assertPlatform(input.platform) : existing.platform;
    const platformUserId = input.platformUserId ?? existing.platformUserId;
    const claim = resolvePlatformClaim(platform, platformUserId);
    if (
      claim.claimed &&
      (claim.claimant.kind === "org" || claim.claimant.identityId !== existing.id)
    ) {
      throw platformClaimConflict(platform, platformUserId, claim.claimant);
    }
    identity = updateIdentity(input.id, {
      ...sharedFields,
      ...(input.platform ? { platform } : {}),
      ...(input.platformUserId ? { platformUserId } : {}),
    });
  } else {
    const platform = assertPlatform(input.platform!);
    const platformUserId = input.platformUserId!;
    // Same canonical resolution the read tool uses, so a caller that checked first
    // cannot get a different answer than the guard that rejects it here.
    const claim = resolvePlatformClaim(platform, platformUserId);
    const claimant = claim.claimed ? claim.claimant : undefined;
    if (claimant?.kind === "org") {
      throw platformClaimConflict(platform, platformUserId, claimant);
    }
    if (claimant) {
      if (claimant.contactId !== input.contactId) {
        throw platformClaimConflict(platform, platformUserId, claimant);
      }
      identity = updateIdentity(claimant.identityId, {
        ...sharedFields,
        platform,
        platformUserId,
      });
    } else {
      identity = createIdentity({
        contactId: input.contactId,
        platform,
        platformUserId,
        ...sharedFields,
      });
    }
  }

  if (!identity) {
    throw new AgentToolError(
      "EXECUTION_ERROR",
      `Failed to upsert identity for contact: ${input.contactId}`,
    );
  }

  recalcEnrichment(input.contactId);

  return {
    ...serializeContactIdentity(identity),
    contactId: input.contactId,
    message: "Contact identity upserted.",
  };
}

export async function handleArchiveContact(input: z.infer<typeof archiveContactSchema>) {
  return archiveContactTool(input.contactId, input.reason);
}

export async function handleFindDuplicateContacts(
  input: z.infer<typeof findDuplicateContactsSchema>,
) {
  const candidates = findDuplicateContacts(input);
  return {
    candidates: candidates.map((candidate) => ({
      primaryContactId: candidate.primaryContactId,
      secondaryContactIds: candidate.secondaryContactIds,
      tier: candidate.tier,
      confidence: candidate.confidence,
      reason: candidate.reason,
      contacts: candidate.members.map((member) => ({
        id: member.contactId,
        name: member.name,
        enrichmentScore: member.enrichmentScore,
        identityCount: member.identityCount,
        // Surfaced so an agent overriding the suggested primary can see which
        // member is the workspace owner — merge_contacts refuses to archive it.
        isSelf: member.isSelf,
      })),
    })),
    total: candidates.length,
  };
}

export async function handleMergeContacts(input: z.infer<typeof mergeContactsSchema>) {
  try {
    return mergeContacts(input);
  } catch (error) {
    if (error instanceof MergeContactsError) {
      // invoke() turns a thrown Error into a 4xx/5xx envelope; keep the code
      // visible so the CLI can tell "bad id" from "server broke".
      throw new Error(`${error.code}: ${error.message}`);
    }
    throw error;
  }
}

export async function handleQueryAnalytics(_input: z.infer<typeof queryAnalyticsSchema>) {
  const metrics = getDashboardMetrics();
  return {
    totalContacts: metrics.totalContacts,
    activeWorkflows: metrics.activeWorkflows,
    pendingTasks: metrics.pendingTasks,
    contentItems: metrics.contentItems,
    recentContacts: metrics.recentContacts.map((c) => ({
      id: c.id,
      name: c.name,
      company: c.company,
      score: c.enrichmentScore,
    })),
  };
}

export async function handleQueryWorkflows(input: z.infer<typeof queryWorkflowsSchema>) {
  const result = listWorkflowRuns({
    workflowType: input.workflowType as WorkflowType | undefined,
    status: input.status,
    page: input.page,
    pageSize: input.pageSize ?? DEFAULT_PAGE_SIZE,
  });

  return {
    total: result.total,
    runs: result.data.map((r) => ({
      id: r.id,
      type: r.workflowType,
      status: r.status,
      trigger: r.trigger,
      model: r.model,
      processedItems: r.processedItems,
      successItems: r.successItems,
      errorItems: r.errorItems,
      costUsd: r.costUsd,
      startedAt: r.startedAt,
      completedAt: r.completedAt,
    })),
  };
}

export async function handleListWorkflowTemplates(
  input: z.infer<typeof listWorkflowTemplatesSchema>
) {
  const templates = listTemplates({
    status: input.status ?? "active",
    pageSize: DEFAULT_PAGE_SIZE,
  });

  return {
    total: templates.total,
    templates: templates.data.map((t) => ({
      id: t.id,
      name: t.name,
      type: t.templateType,
      description: t.description,
    })),
  };
}

export async function handleStartWorkflow(input: z.infer<typeof startWorkflowSchema>) {
  if (isRtxEmbedded()) {
    try {
      const rtxResult = await runTemplateViaRtx({
        templateId: input.templateId,
      });
      if (rtxResult.success) {
        return {
          runId: rtxResult.workflowRunId,
          status: "running",
          workflowType: rtxResult.workflowRun.workflowType,
          message: `Workflow launched in RealTimeX thread ${rtxResult.threadSlug}`,
          threadSlug: rtxResult.threadSlug,
          threadPath: rtxResult.threadPath,
        };
      }
    } catch (err) {
      console.warn("[handleStartWorkflow] RTX run failed, falling back to db record:", err);
    }
  }

  const run = startAgentWorkflow({
    templateId: input.templateId,
    workflowType: (input.workflowType as WorkflowType) ?? "agent",
  });

  return {
    runId: run.id,
    status: run.status,
    workflowType: run.workflowType,
    message: AGENT_ORCHESTRATION_MESSAGE,
  };
}

export async function handleDispatchFollowOnWorkflow(
  input: z.infer<typeof dispatchFollowOnWorkflowSchema>
) {
  const result = dispatchWorkflowCascade({
    parentRunId: input.parentWorkflowRunId,
    createdContactIds: input.contactIds ?? [],
    overrideAction: input.followOnAction,
  });

  if (result.triggered && result.childRunIds && result.childRunIds.length > 0 && isRtxEmbedded()) {
    await Promise.all(
      result.childRunIds.map(async (childRunId) => {
        try {
          const childRun = getWorkflowRun(childRunId);
          if (childRun && childRun.templateId) {
            const childConfig = JSON.parse(childRun.config ?? "{}") as Record<string, unknown>;
            await runTemplateViaRtx({
              templateId: childRun.templateId,
              config: childConfig,
              existingRunId: childRun.id,
            });
          }
        } catch (err) {
          console.warn(`[handleDispatchFollowOnWorkflow] Failed to launch RTX agent for child run ${childRunId}:`, err);
        }
      }),
    );

    try {
      const orchestratorThread = await getOrCreateOrchestratorThread();
      const orchestratorSessionId = await resolveActiveTerminalSessionIdForThread(
        orchestratorThread.workspaceSlug,
        orchestratorThread.threadSlug
      );
      scheduleTerminalSessionRelease(orchestratorSessionId);
    } catch (err) {
      console.warn(
        "[handleDispatchFollowOnWorkflow] Failed to schedule orchestrator terminal teardown:",
        err
      );
    }
  }

  return {
    success: result.triggered,
    childRunId: result.childRunId,
    targetTemplateName: result.targetTemplateName,
    followOnAction: result.followOnAction,
    reason: result.reason,
  };
}

export async function handleQueryContent(input: z.infer<typeof queryContentSchema>) {
  const result = listContentItems({
    contentType: input.contentType,
    status: input.status,
    page: input.page,
    pageSize: input.pageSize ?? DEFAULT_PAGE_SIZE,
  });

  return {
    total: result.total,
    items: result.data.map((item) => ({
      id: item.id,
      title: item.title,
      contentType: item.contentType,
      status: item.status,
      origin: item.origin,
      body: item.body ? item.body.slice(0, 200) : null,
      publishedAt: item.post?.publishedAt ?? null,
    })),
  };
}

export async function handleQueryGoals(input: z.infer<typeof queryGoalsSchema>) {
  const result = listGoals({
    status: input.status,
    goalType: input.goalType,
    page: input.page,
    pageSize: input.pageSize ?? DEFAULT_PAGE_SIZE,
  });

  return {
    total: result.total,
    goals: result.data.map((g) => ({
      id: g.id,
      name: g.name,
      goalType: g.goalType,
      targetValue: g.targetValue,
      currentValue: g.currentValue,
      unit: g.unit,
      status: g.status,
      deadline: g.deadline,
    })),
  };
}

export async function handleCreateTask(input: z.infer<typeof createTaskSchema>) {
  const task = createTask({
    title: input.title,
    description: input.description ?? null,
    priority: input.priority ?? "medium",
    dueAt: input.dueDate ?? null,
    relatedContactId: input.relatedContactId ?? null,
    relatedOrgId: input.relatedOrgId ?? null,
    assignee: "user",
  });

  return {
    id: task.id,
    title: task.title,
    priority: task.priority,
    status: task.status,
    message: `Task "${task.title}" created successfully.`,
  };
}

export async function handleGetPersona(input: z.infer<typeof getPersonaSchema>) {
  const persona = getActivePersona(input.contactId, {
    includeLocalOnly: input.includeLocalOnly ?? false,
  });

  if (!persona) {
    return { error: `No persona found for contact: ${input.contactId}` };
  }

  return serializePersonaRow(persona);
}

function serializePersonaRow(persona: NonNullable<ReturnType<typeof getActivePersona>>) {
  return {
    id: persona.id,
    contactId: persona.contactId,
    archetype: persona.archetype,
    tone: persona.tone,
    summary: persona.summary,
    description: persona.description,
    interests: JSON.parse(persona.interests ?? "[]"),
    conversionTriggers: JSON.parse(persona.conversionTriggers ?? "[]"),
    engagementFormats: JSON.parse(persona.engagementFormats ?? "[]"),
    confidence: persona.confidence,
    scope: persona.scope,
    model: persona.model,
    sourceWindow: JSON.parse(persona.sourceWindow ?? "{}"),
    workflowRunId: persona.workflowRunId,
    generatedAt: persona.generatedAt,
  };
}

export async function handleGetPersonaEvidence(input: z.infer<typeof getPersonaEvidenceSchema>) {
  return assemblePersonaEvidence(input.contactId);
}

export async function handleGeneratePersona(input: z.infer<typeof generatePersonaSchema>) {
  const result = await generatePersona(input.contactId, {
    force: input.force,
    trigger: "user",
  });

  if (!result.generated) {
    return result;
  }

  return {
    generated: true,
    workflowRunId: result.workflowRunId,
    supersededPersonaId: result.supersededPersonaId,
    nicheEdgesUpserted: result.nicheEdgesUpserted,
    embedded: result.embedded,
    persona: serializePersonaRow(result.persona),
  };
}

export async function handleUpsertPersona(input: z.infer<typeof upsertPersonaSchema>) {
  const persona = upsertPersona({
    contactId: input.contactId,
    archetype: input.archetype,
    tone: input.tone,
    summary: input.summary,
    description: input.description,
    interests: input.interests,
    conversionTriggers: input.conversionTriggers,
    engagementFormats: input.engagementFormats,
    confidence: input.confidence,
    scope: input.scope,
    model: input.model,
    sourceWindow: input.sourceWindow,
    workflowRunId: input.workflowRunId,
  });

  return {
    id: persona.id,
    contactId: persona.contactId,
    archetype: persona.archetype,
    tone: persona.tone,
    summary: persona.summary,
    message: "Persona saved (previous active persona superseded if present).",
  };
}

export async function handleCompleteWorkflowRun(input: z.infer<typeof completeWorkflowRunSchema>) {
  const run = getWorkflowRun(input.runId);
  if (!run) {
    return { error: `Workflow run ${input.runId} not found` };
  }

  const completedAt = Math.floor(Date.now() / 1000);
  let existingResult: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(run.result ?? "{}");
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      existingResult = parsed as Record<string, unknown>;
    }
  } catch {
    // Malformed legacy result JSON must not block workflow completion.
  }
  const cohort = resolveRunCohort(run, input.createdContactIds);
  const resultJson = JSON.stringify({
    ...existingResult,
    ...(input.summary ? { summary: input.summary } : {}),
    ...(cohort.contactIds.length > 0 ? { createdContactIds: cohort.contactIds } : {}),
  });

  const updatedRun = updateWorkflowRun(input.runId, {
    status: input.status,
    completedAt,
    ...(input.processedItems !== undefined
      ? { processedItems: input.processedItems }
      : cohort.contactIds.length > run.processedItems
        ? { processedItems: cohort.contactIds.length }
        : {}),
    ...(input.successItems !== undefined ? { successItems: input.successItems } : {}),
    result: resultJson,
    ...(input.errors ? { errors: JSON.stringify(input.errors) } : {}),
  });

  // Automatically emit completion event and trigger workflow cascading / webhook bridge
  const eventResult = await emitWorkflowCompletedEvent(input.runId, {
    summary: input.summary,
    createdContactIds: cohort.contactIds.length > 0 ? cohort.contactIds : undefined,
  });

  const runtimeSessionId = getRtxRuntimeSessionIdFromRunConfig(run.config);
  const browserSessionTeardown = await stopRunningRtxBrowserSessions({
    stopAllRunning: true,
  });
  const terminalSessionTeardown = scheduleWorkflowTerminalSessionRelease(runtimeSessionId);
  const teardownNote = formatDeferredTerminalTeardownNote({
    terminal: terminalSessionTeardown,
    browser: browserSessionTeardown,
  });

  return {
    success: true,
    runId: updatedRun?.id ?? input.runId,
    status: updatedRun?.status ?? input.status,
    completedAt: updatedRun?.completedAt ?? completedAt,
    processedItems: updatedRun?.processedItems ?? input.processedItems ?? 0,
    createdContactIds: cohort.contactIds,
    cohortSources: cohort.sources,
    cascadeResult: eventResult.cascadeResult,
    routingRecommendation: eventResult.routingRecommendation,
    terminalSessionTeardown: terminalSessionTeardown.sessionId
      ? { scheduled: true, sessionId: terminalSessionTeardown.sessionId }
      : { scheduled: false },
    browserSessionTeardown,
    message: `Workflow run ${input.runId} marked as ${input.status}. Follow-on cascades and webhook dispatch completed.${teardownNote}`,
  };
}

export async function handleRecordWorkflowRunContacts(
  input: z.infer<typeof recordWorkflowRunContactsSchema>,
) {
  try {
    return recordRunCohort(input);
  } catch (error) {
    if (error instanceof RunCohortError) {
      const code = error.code === "RUN_NOT_FOUND" || error.code === "TEMPLATE_NOT_FOUND"
        ? "NOT_FOUND"
        : "VALIDATION_ERROR";
      throw new AgentToolError(code, error.message, { reason: error.code });
    }
    throw error;
  }
}
