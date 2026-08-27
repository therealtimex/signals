import { z } from "zod";
import { PLATFORMS } from "@/lib/db/platforms";
import {
  RELATIONSHIP_GOAL_ENUM,
  RELATIONSHIP_GOAL_STATUS_ENUM,
} from "@/lib/relationship-goals";

const funnelStage = z.enum([
  "prospect",
  "engaged",
  "qualified",
  "opportunity",
  "customer",
  "advocate",
]);

const relationshipGoal = z.enum(RELATIONSHIP_GOAL_ENUM);
const relationshipGoalStatus = z.enum(RELATIONSHIP_GOAL_STATUS_ENUM);

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

import { CREATED_SOURCES } from "@/lib/db/creation-sources";

export const queryContactsSchema = z.object({
  search: z.string().optional(),
  email: z.string().min(1).optional(),
  funnelStage: funnelStage.optional(),
  relationshipGoal: relationshipGoal.optional(),
  relationshipGoalStatus: relationshipGoalStatus.optional(),
  platform: platform.optional(),
  platformUserId: z.string().min(1).optional(),
  page: z.number().int().positive().optional(),
  pageSize: z.number().int().positive().max(100).optional(),
  sort: z.enum(["createdAt", "enrichmentScore"]).optional(),
  order: z.enum(["asc", "desc"]).optional(),
  createdSource: z.enum(CREATED_SOURCES).optional(),
  createdSourceDetail: z.string().min(1).optional(),
  createdWorkflowRunId: z.string().min(1).optional(),
  createdTemplateId: z.string().min(1).optional(),
  minEnrichmentScore: z.number().int().optional(),
  maxEnrichmentScore: z.number().int().optional(),
});

export const resolvePlatformClaimSchema = z.object({
  platform: platform,
  platformUserId: z.string().min(1),
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
  headline: z.string().optional(),
  bio: z.string().optional(),
  location: z.string().optional(),
  website: z.string().optional(),
  platform: platform.optional(),
  platformUserId: z.string().min(1).optional(),
  platformHandle: z.string().optional(),
  platformUrl: z.string().optional(),
  avatarUrl: z.string().optional(),
  notes: z.string().optional(),
  funnelStage: funnelStage.optional(),
  relationshipGoal: relationshipGoal.optional(),
  relationshipGoalStatus: relationshipGoalStatus.optional(),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  workflowRunId: z.string().min(1).optional(),
  templateId: z.string().min(1).optional(),
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
  relationshipGoal: relationshipGoal.optional().nullable(),
  relationshipGoalStatus: relationshipGoalStatus.optional().nullable(),
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

export const findDuplicateContactsSchema = z.object({
  tiers: z.array(z.union([z.literal(1), z.literal(2), z.literal(3)])).optional(),
  minConfidence: z.number().min(0).max(1).optional(),
  limit: z.number().int().positive().max(200).optional(),
  contactIds: z.array(z.string().min(1)).optional(),
});

export const mergeContactsSchema = z.object({
  primaryContactId: z.string().min(1),
  secondaryContactIds: z.array(z.string().min(1)).min(1),
  options: z
    .object({
      autoRecalculateScore: z.boolean().optional(),
      dryRun: z.boolean().optional(),
      reason: z.string().optional(),
      workflowRunId: z.string().optional(),
    })
    .optional(),
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
  workflowType: z.enum(["search", "enrich", "prune", "agent", "nurture", "content", "sync"]).optional(),
  config: z.record(z.unknown()).optional(),
  parentWorkflowId: z.string().optional(),
  targetContactIds: z.array(z.string().min(1)).optional(),
});

export const dispatchFollowOnWorkflowSchema = z.object({
  parentWorkflowRunId: z.string().min(1),
  followOnAction: z.enum(["profile_pipeline", "contact_nurture", "social_patrol", "agentic_router"]),
  contactIds: z.array(z.string().min(1)).optional(),
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

export const getPersonaJobSchema = z.object({
  jobId: z.string().min(1),
});

export const completePersonaJobSchema = z
  .object({
    jobId: z.string().min(1),
    success: z.boolean(),
    synthesis: z.union([z.string(), z.record(z.unknown())]).optional(),
    model: z.string().max(120).optional(),
    error: z.string().max(2000).optional(),
  })
  .refine((value) => !value.success || value.synthesis !== undefined, {
    message: "synthesis is required when success is true",
    path: ["synthesis"],
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

export const listMailAccountsSchema = z.object({});

export const completeWorkflowRunSchema = z.object({
  runId: z.string().min(1).describe("The workflow run ID to mark completed"),
  status: z.enum(["completed", "failed"]).default("completed").describe("Final status of the workflow run"),
  processedItems: z.number().int().nonnegative().optional().describe("Number of items processed"),
  successItems: z.number().int().nonnegative().optional().describe("Number of items successfully processed"),
  createdContactIds: z.array(z.string()).optional().describe("IDs of newly created/discovered contacts in this run"),
  summary: z.string().optional().describe("Summary of the run results and mapped cluster"),
  errors: z.array(z.string()).optional().describe("Any error messages encountered during the run"),
});
