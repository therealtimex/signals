import { z } from "zod";

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
});

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
  kind: z.enum(["profile", "description", "body"]).optional(),
  k: z.number().int().positive().max(100).optional(),
  includeLocalOnly: z.boolean().optional(),
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
