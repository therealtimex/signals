import { listContacts, getContactById, createContact, updateContact } from "@/lib/db/queries/contacts";
import { getDashboardMetrics } from "@/lib/db/queries/dashboard";
import { listWorkflowRuns } from "@/lib/db/queries/workflows";
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
import type { WorkflowType } from "@/lib/workflows/types";
import type {
  archiveContactSchema,
  createContactSchema,
  createTaskSchema,
  enrichContactSchema,
  getContactSchema,
  listWorkflowTemplatesSchema,
  queryAnalyticsSchema,
  queryContactsSchema,
  queryContentSchema,
  queryGoalsSchema,
  queryWorkflowsSchema,
  startWorkflowSchema,
  updateContactSchema,
  getPersonaSchema,
  getPersonaEvidenceSchema,
  generatePersonaSchema,
  upsertPersonaSchema,
} from "@/lib/agent-tools/schemas";
import type { z } from "zod";

const DEFAULT_PAGE_SIZE = 20;

function primaryPlatform(
  identities: { platform: string; isPrimary: number | boolean }[],
): string | null {
  const primary = identities.find((id) => id.isPrimary);
  return primary?.platform ?? identities[0]?.platform ?? null;
}

export async function handleQueryContacts(input: z.infer<typeof queryContactsSchema>) {
  const result = listContacts({
    search: input.search,
    funnelStage: input.funnelStage,
    platform: input.platform,
    page: input.page,
    pageSize: input.pageSize ?? DEFAULT_PAGE_SIZE,
    sort: input.sort,
    order: input.order,
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
      platform: primaryPlatform(c.identities),
      identityCount: c.identities.length,
    })),
  };
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
    platform: primaryPlatform(contact.identities),
    funnelStage: contact.funnelStage,
    enrichmentScore: contact.enrichmentScore,
    tags: contact.tags,
    identities: contact.identities.map((id) => ({
      platform: id.platform,
      handle: id.platformHandle,
      profileUrl: id.platformUrl,
    })),
  };
}

export async function handleCreateContact(input: z.infer<typeof createContactSchema>) {
  const payload: Parameters<typeof createContact>[0] = {
    name: input.name,
    firstName: input.firstName,
    lastName: input.lastName,
    funnelStage: input.funnelStage ?? "prospect",
  };

  if (input.email !== undefined) payload.email = input.email || null;
  if (input.phone !== undefined) payload.phone = input.phone ?? null;
  if (input.channels !== undefined) payload.channels = input.channels;

  if (input.employments !== undefined) {
    payload.employments = input.employments;
  } else {
    if (input.company !== undefined) payload.company = input.company ?? null;
    if (input.title !== undefined) payload.title = input.title ?? null;
  }

  const contact = createContact(payload, "agent:create_contact");

  return {
    id: contact.id,
    name: contact.name,
    email: contact.email,
    company: contact.company,
    currentEmployment: contact.currentEmployment,
    enrichmentScore: contact.enrichmentScore,
    message: `Contact "${contact.name}" created successfully.`,
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
    enrichmentScore: updated.enrichmentScore,
    message: `Contact "${updated.name}" updated successfully.`,
  };
}

export async function handleEnrichContact(input: z.infer<typeof enrichContactSchema>) {
  const { contactId, ...data } = input;
  return enrichContact(contactId, data);
}

export async function handleArchiveContact(input: z.infer<typeof archiveContactSchema>) {
  return archiveContactTool(input.contactId, input.reason);
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
