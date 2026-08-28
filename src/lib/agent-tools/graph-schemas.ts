import { z } from "zod";
import {
  accountStageSchema,
  companySizeSchema,
  orgTypeSchema,
  orgUpdateFieldsSchema,
} from "@/lib/orgs/schemas";

const graphNodeType = z.enum([
  "contact",
  "org",
  "content",
  "goal",
  "niche",
  "launch",
  "variant",
  "interaction",
  "workflow_run",
  "platform_identity",
  "org_identity",
]);

export const NODE_TYPES = graphNodeType.options;

export const queryOrgsSchema = z.object({
  search: z.string().optional(),
  page: z.number().int().positive().optional(),
  pageSize: z.number().int().positive().max(100).optional(),
  includeLocalOnly: z.boolean().optional(),
  stage: accountStageSchema.optional(),
  owner: z.string().min(1).optional(),
  followed: z.boolean().optional(),
  tag: z.string().trim().min(1).optional(),
});

export const getOrgSchema = z
  .object({
    orgId: z.string().min(1).optional(),
    domain: z.string().min(1).optional(),
  })
  .refine((input) => Boolean(input.orgId || input.domain), {
    message: "orgId or domain is required",
  });

export const createOrgSchema = z.object({
  name: z.string().trim().min(1).max(240),
  orgType: orgTypeSchema.optional(),
  domain: z.string().trim().max(255).nullable().optional(),
  website: z.string().trim().max(2_048).nullable().optional(),
  description: z.string().trim().max(10_000).nullable().optional(),
  location: z.string().trim().max(500).nullable().optional(),
  avatarUrl: z.string().url().nullable().optional(),
  industry: z.string().trim().max(500).nullable().optional(),
  companySize: companySizeSchema.nullable().optional(),
  tags: z.array(z.string().trim().min(1).max(100)).max(50).optional(),
  ownerContactId: z.string().min(1).nullable().optional(),
  accountStage: accountStageSchema.nullable().optional(),
  workflowRunId: z.string().min(1).optional(),
  templateId: z.string().min(1).optional(),
});

export const updateOrgSchema = orgUpdateFieldsSchema.extend({
  orgId: z.string().min(1),
  workflowRunId: z.string().min(1).optional(),
  fieldSources: z
    .record(z.object({ evidenceUrl: z.string().url().optional() }))
    .optional(),
});

export const getOrgRelationshipsSchema = z.object({
  orgId: z.string().min(1),
  includeLocalOnly: z.boolean().optional(),
});

export const listOrgContactsSchema = z.object({
  orgId: z.string().min(1),
  q: z.string().optional(),
  employment: z.enum(["current", "former", "all"]).optional(),
  band: z.enum(["unknown", "weak", "moderate", "strong"]).optional(),
  sort: z.enum(["name", "strength", "lastInteraction", "title"]).optional(),
  dir: z.enum(["asc", "desc"]).optional(),
  page: z.number().int().positive().optional(),
  pageSize: z.number().int().positive().max(100).optional(),
  includeLocalOnly: z.boolean().optional(),
});

export const linkContactToOrgSchema = z.object({
  orgId: z.string().min(1),
  contactId: z.string().min(1),
  title: z.string().trim().max(500).nullable().optional(),
  isCurrent: z.boolean().optional(),
  startedAt: z.number().int().nullable().optional(),
});

export const unlinkContactFromOrgSchema = z.object({
  orgId: z.string().min(1),
  contactId: z.string().min(1),
  mode: z.enum(["remove", "mark_former"]).optional(),
});

export const getOrgEmailIntelligenceSchema = z.object({ orgId: z.string().min(1) });
export const inferOrgEmailPatternSchema = z.object({
  orgId: z.string().min(1),
  checkMail: z.boolean().optional(),
});
export const setOrgEmailPatternSchema = z.object({
  orgId: z.string().min(1),
  pattern: z.string().optional(),
  evidenceUrl: z.string().url().optional(),
  clear: z.boolean().optional(),
}).refine((input) => input.clear || Boolean(input.pattern), {
  message: "pattern is required unless clear is true",
  path: ["pattern"],
});
export const generateOrgEmailCandidatesSchema = z.object({
  orgId: z.string().min(1),
  contactIds: z.array(z.string().min(1)).optional(),
});
const emailCandidateStatusSchema = z.enum(["predicted", "uncertain", "verified", "invalid"]);
export const listEmailCandidatesSchema = z.object({
  orgId: z.string().min(1).optional(),
  contactId: z.string().min(1).optional(),
  status: emailCandidateStatusSchema.optional(),
}).refine((input) => Boolean(input.orgId || input.contactId), {
  message: "orgId or contactId is required",
});
export const updateEmailCandidateSchema = z.object({
  candidateId: z.string().min(1),
  action: z.enum(["verify", "invalidate", "mark_uncertain", "correct", "probe"]),
  address: z.string().email().optional(),
  evidenceUrl: z.string().url().optional(),
  note: z.string().max(2_000).optional(),
});
export const addOrgDomainAliasSchema = z.object({
  orgId: z.string().min(1),
  domain: z.string().trim().min(1).max(255),
});

export const logOrgActivitySchema = z.object({
  orgId: z.string().min(1),
  contactId: z.string().min(1).nullable().optional(),
  activityType: z.enum([
    "funding", "hiring", "leadership_change", "product_launch", "news", "content",
    "engagement", "note", "contact_linked", "contact_unlinked", "profile_updated",
    "profile_enriched", "email_pattern_inferred", "email_verified", "followed",
    "unfollowed", "workflow_started", "task_created",
  ]),
  title: z.string().trim().min(1).max(500),
  summary: z.string().max(20_000).nullable().optional(),
  whyItMatters: z.string().max(4_000).nullable().optional(),
  recommendedAction: z.record(z.unknown()).optional(),
  url: z.string().url().nullable().optional(),
  occurredAt: z.number().int().optional(),
  workflowRunId: z.string().min(1).nullable().optional(),
  dedupeKey: z.string().min(1).optional(),
  scope: z.enum(["shared", "local_only"]).optional(),
  metadata: z.record(z.unknown()).optional(),
});
export const listOrgActivitySchema = z.object({
  orgId: z.string().min(1),
  category: z.enum(["signal", "workspace", "all"]).optional(),
  types: z.array(z.string().min(1)).optional(),
  since: z.number().int().optional(),
  page: z.number().int().positive().optional(),
  pageSize: z.number().int().positive().max(100).optional(),
  includeLocalOnly: z.boolean().optional(),
});
export const followOrgSchema = z.object({ orgId: z.string().min(1), follow: z.boolean() });

export const queryGraphSchema = z.object({
  nodeType: graphNodeType,
  nodeId: z.string().min(1),
  edgeTypes: z.array(z.string()).optional(),
  direction: z.enum(["outgoing", "incoming", "both"]).optional(),
  includeLocalOnly: z.boolean().optional(),
});

export const upsertEdgeSchema = z.object({
  srcType: graphNodeType,
  srcId: z.string().min(1),
  dstType: graphNodeType,
  dstId: z.string().min(1),
  edgeType: z.string().min(1),
  weight: z.number().optional(),
  properties: z.record(z.unknown()).optional(),
  propertiesPrivate: z.record(z.unknown()).optional(),
  scope: z.enum(["shared", "local_only"]).optional(),
  source: z.string().optional(),
});

export const logInteractionSchema = z.object({
  contactId: z.string().min(1),
  interactionType: z.string().min(1),
  occurredAt: z.number().int().optional(),
  orgId: z.string().optional(),
  direction: z.enum(["inbound", "outbound", "mutual"]).optional(),
  summary: z.string().optional(),
  isMeaningful: z.boolean().optional(),
  scope: z.enum(["shared", "local_only"]).optional(),
  contentItemId: z.string().optional(),
  attachmentIds: z.array(z.string().min(1)).optional(),
  metadata: z.record(z.unknown()).optional(),
});

export const queryNichesSchema = z.object({
  search: z.string().optional(),
  status: z.enum(["candidate", "active", "merged", "archived"]).optional(),
  page: z.number().int().positive().optional(),
  pageSize: z.number().int().positive().max(100).optional(),
  includeLocalOnly: z.boolean().optional(),
});

export const upsertNicheSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1),
  description: z.string().optional(),
  nicheType: z.enum(["interest", "firmographic", "behavioral", "custom"]).optional(),
  status: z.enum(["candidate", "active", "merged", "archived"]).optional(),
  scope: z.enum(["shared", "local_only"]).optional(),
  metadata: z.record(z.unknown()).optional(),
});

export const queryLaunchesSchema = z.object({
  search: z.string().optional(),
  status: z
    .enum(["draft", "generating", "simulating", "ready", "live", "completed", "archived"])
    .optional(),
  page: z.number().int().positive().optional(),
  pageSize: z.number().int().positive().max(100).optional(),
  includeLocalOnly: z.boolean().optional(),
});

export const upsertLaunchSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1),
  brief: z.string().optional(),
  status: z
    .enum(["draft", "generating", "simulating", "ready", "live", "completed", "archived"])
    .optional(),
  primaryPlatform: z.string().optional(),
  audienceSpec: z.record(z.unknown()).optional(),
  workflowTemplateId: z.string().optional(),
  scope: z.enum(["shared", "local_only"]).optional(),
  metadata: z.record(z.unknown()).optional(),
  launchedAt: z.number().int().optional(),
  completedAt: z.number().int().optional(),
});

export const upsertVariantSchema = z.object({
  id: z.string().optional(),
  launchId: z.string().min(1),
  label: z.string().optional(),
  variantType: z.string().optional(),
  body: z.string().optional(),
  contentItemId: z.string().optional(),
  status: z.enum(["draft", "simulated", "selected", "published", "rejected"]).optional(),
  predictedScore: z.number().optional(),
  predictionConfidence: z.number().optional(),
  predictedMetrics: z.record(z.unknown()).optional(),
  predictionModel: z.string().optional(),
  simulatedAt: z.number().int().optional(),
  generationModel: z.string().optional(),
  generationMetadata: z.record(z.unknown()).optional(),
  metadata: z.record(z.unknown()).optional(),
  platform: z.string().optional(),
  publishedAt: z.number().int().optional(),
});

export const semanticSearchSchema = z.object({
  query: z.string().min(1),
  nodeTypes: z.array(graphNodeType).optional(),
  kind: z.enum(["profile", "description", "body", "persona"]).optional(),
  k: z.number().int().positive().max(100).optional(),
  includeLocalOnly: z.boolean().optional(),
});

const populationSpecSchema = z.object({
  contactIds: z.array(z.string()).optional(),
  nicheIds: z.array(z.string()).optional(),
  orgIds: z.array(z.string()).optional(),
  sampleSize: z.number().int().positive().optional(),
  seed: z.number().int().optional(),
});

export const createSimulationRunSchema = z.object({
  variantId: z.string().min(1),
  populationSpec: populationSpecSchema.optional(),
  batchId: z.string().optional(),
  predictionModel: z.string().optional(),
  config: z.record(z.unknown()).optional(),
});

export const querySimulationsSchema = z.object({
  variantId: z.string().optional(),
  launchId: z.string().optional(),
  batchId: z.string().optional(),
  status: z.enum(["pending", "running", "completed", "failed", "cancelled"]).optional(),
  includeAgents: z.boolean().optional(),
  includeTranscripts: z.boolean().optional(),
  includeCalibrations: z.boolean().optional(),
  page: z.number().int().positive().optional(),
  pageSize: z.number().int().positive().max(100).optional(),
});

const simulationAgentResultSchema = z.object({
  agentId: z.string().min(1),
  engagementScore: z.number().min(0).max(100).optional(),
  outcome: z.string().optional(),
  predictedActions: z.union([z.array(z.record(z.unknown())), z.record(z.unknown())]).optional(),
  transcript: z.unknown().optional(),
});

export const recordSimulationResultsSchema = z.object({
  runId: z.string().min(1),
  results: z.array(simulationAgentResultSchema).min(1),
});

export const completeSimulationRunObjectSchema = z.object({
  runId: z.string().min(1),
  status: z.enum(["completed", "failed", "cancelled"]).optional(),
  predictedScore: z.number().min(0).max(100).optional(),
  predictionConfidence: z.number().min(0).max(1).optional(),
  predictedMetrics: z.record(z.number().nonnegative()).optional(),
  error: z.string().optional(),
});

export const completeSimulationRunSchema = completeSimulationRunObjectSchema.superRefine(
  (input, ctx) => {
    const status = input.status ?? "completed";
    if (status !== "completed") return;
    if (input.predictedMetrics === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["predictedMetrics"],
        message:
          "predictedMetrics is required when completing a simulation run (engagement_metrics keyspace)",
      });
    }
  },
);

export const calibrateSimulationRunSchema = z.object({
  runId: z.string().min(1),
  observedUntil: z.number().int().optional(),
});

export const queryOrgIdentitiesSchema = z.object({
  orgId: z.string().optional(),
  platform: z.string().optional(),
  page: z.number().int().positive().optional(),
  pageSize: z.number().int().positive().max(100).optional(),
});

export const upsertOrgIdentitySchema = z.object({
  id: z.string().optional(),
  orgId: z.string().min(1),
  platform: z.string().min(1),
  platformUserId: z.string().min(1),
  platformHandle: z.string().optional(),
  platformUrl: z.string().optional(),
  platformData: z.record(z.unknown()).optional(),
  displayName: z.string().optional(),
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
});
