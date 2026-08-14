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
]);

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
