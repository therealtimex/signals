import { z } from "zod";
import { PLATFORMS } from "@/lib/db/platforms";

const funnelStage = z.enum([
  "prospect",
  "engaged",
  "qualified",
  "opportunity",
  "customer",
  "advocate",
]);

const platform = z.enum(PLATFORMS as unknown as [string, ...string[]]);

export const channelInputSchema = z.object({
  id: z.string().min(1).optional(),
  channelType: z.string().min(1),
  value: z.string().min(1),
  label: z.string().optional().nullable(),
  isPrimary: z.boolean().optional(),
  isVerified: z.boolean().optional(),
});

export const employmentInputSchema = z.object({
  id: z.string().min(1).optional(),
  orgId: z.string().min(1).optional(),
  orgName: z.string().optional(),
  title: z.string().optional().nullable(),
  startedAt: z.number().int().optional().nullable(),
  endedAt: z.number().int().optional().nullable(),
  isCurrent: z.boolean().optional(),
});

export const queryContactsSchema = z.object({
  search: z.string().optional(),
  funnelStage: funnelStage.optional(),
  platform: platform.optional(),
  page: z.number().int().positive().optional(),
  pageSize: z.number().int().positive().max(100).optional(),
  sort: z.enum(["createdAt", "enrichmentScore"]).optional(),
  order: z.enum(["asc", "desc"]).optional(),
});

export const getContactSchema = z.object({
  contactId: z.string().min(1),
});

export const createContactSchema = z.object({
  name: z.string().min(1),
  email: z.string().email().optional().or(z.literal("")),
  phone: z.string().optional(),
  channels: z.array(channelInputSchema).optional(),
  employments: z.array(employmentInputSchema).optional(),
  company: z.string().optional(),
  title: z.string().optional(),
  funnelStage: funnelStage.optional(),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
});

export const updateContactSchema = z.object({
  contactId: z.string().min(1),
  email: z.string().email().optional().or(z.literal("")),
  phone: z.string().optional(),
  channels: z.array(channelInputSchema).optional(),
  employments: z.array(employmentInputSchema).optional(),
  company: z.string().optional(),
  title: z.string().optional(),
  headline: z.string().optional(),
  bio: z.string().optional(),
  location: z.string().optional(),
  website: z.string().optional(),
  funnelStage: funnelStage.optional(),
  tags: z.string().optional(),
  is_self: z.boolean().optional(),
});

export const enrichContactSchema = z.object({
  contactId: z.string().min(1),
  company: z.string().optional(),
  title: z.string().optional(),
  headline: z.string().optional(),
  email: z.string().optional(),
  phone: z.string().optional(),
  location: z.string().optional(),
  website: z.string().optional(),
  bio: z.string().optional(),
  tags: z.array(z.string()).optional(),
  metadata: z.record(z.unknown()).optional(),
});

export const archiveContactSchema = z.object({
  contactId: z.string().min(1),
  reason: z.string().min(1),
});

export const upsertContactIdentitySchema = z
  .object({
    id: z.string().optional(),
    contactId: z.string().min(1),
    platform: platform.optional(),
    platformUserId: z.string().min(1).optional(),
    platformHandle: z.string().optional(),
    platformUrl: z.string().optional(),
    platformData: z.record(z.unknown()).optional(),
    displayName: z.string().optional(),
    headline: z.string().optional(),
    bio: z.string().optional(),
    avatarUrl: z.string().optional(),
    location: z.string().optional(),
    websiteUrl: z.string().optional(),
    isVerified: z.boolean().optional(),
    followersCount: z.number().int().optional(),
    followingCount: z.number().int().optional(),
    postsCount: z.number().int().optional(),
    listedCount: z.number().int().optional(),
    platformCreatedAt: z.number().int().optional(),
    isPrimary: z.boolean().optional(),
    isActive: z.boolean().optional(),
    lastSyncedAt: z.number().int().optional(),
  })
  .refine((data) => data.id || (data.platform && data.platformUserId), {
    message: "platform and platformUserId are required when creating a new identity",
  });

export const queryGoalsSchema = z.object({
  status: z.enum(["active", "achieved", "missed", "paused"]).optional(),
  goalType: z
    .enum(["audience_growth", "lead_generation", "content_engagement", "pipeline_progression"])
    .optional(),
  page: z.number().int().positive().optional(),
  pageSize: z.number().int().positive().max(100).optional(),
});

export const queryAnalyticsSchema = z.object({});

export const queryWorkflowsSchema = z.object({
  workflowType: z
    .enum(["sync", "import", "enrich", "search", "prune", "sequence", "agent", "simulate", "calibrate"])
    .optional(),
  status: z
    .enum(["pending", "running", "paused", "completed", "failed", "cancelled"])
    .optional(),
  page: z.number().int().positive().optional(),
  pageSize: z.number().int().positive().max(100).optional(),
});

export const queryContentSchema = z.object({
  contentType: z.enum(["post", "thread", "article", "newsletter", "dm", "reply"]).optional(),
  status: z
    .enum([
      "draft",
      "review",
      "approved",
      "scheduled",
      "published",
      "imported",
      "queued",
      "publishing",
      "failed",
    ])
    .optional(),
  page: z.number().int().positive().optional(),
  pageSize: z.number().int().positive().max(100).optional(),
});

export const createTaskSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
  dueDate: z.number().int().optional(),
  relatedContactId: z.string().optional(),
});

export const listWorkflowTemplatesSchema = z.object({
  status: z.enum(["active", "paused", "draft", "completed"]).optional(),
});

export const startWorkflowSchema = z.object({
  templateId: z.string().min(1),
  workflowType: z.enum(["search", "enrich", "prune", "agent"]).optional(),
});

export const getPersonaSchema = z.object({
  contactId: z.string().min(1),
  includeLocalOnly: z.boolean().optional(),
});

export const getPersonaEvidenceSchema = z.object({
  contactId: z.string().min(1),
});

export const generatePersonaSchema = z.object({
  contactId: z.string().min(1),
  force: z.boolean().optional(),
});

export const upsertPersonaSchema = z
  .object({
    contactId: z.string().min(1),
    archetype: z.string().optional(),
    tone: z.string().optional(),
    summary: z.string().optional(),
    description: z.string().optional(),
    interests: z.array(z.string()).optional(),
    conversionTriggers: z.array(z.string()).optional(),
    engagementFormats: z.array(z.string()).optional(),
    confidence: z.number().min(0).max(1).optional(),
    scope: z.enum(["shared", "local_only"]).optional(),
    model: z.string().optional(),
    sourceWindow: z.record(z.unknown()).optional(),
    workflowRunId: z.string().optional(),
  })
  .refine(
    (data) =>
      data.archetype !== undefined ||
      data.tone !== undefined ||
      data.summary !== undefined ||
      data.description !== undefined ||
      data.interests !== undefined ||
      data.conversionTriggers !== undefined ||
      data.engagementFormats !== undefined ||
      data.confidence !== undefined ||
      data.scope !== undefined ||
      data.model !== undefined ||
      data.sourceWindow !== undefined ||
      data.workflowRunId !== undefined,
    { message: "At least one persona field is required besides contactId" },
  );
