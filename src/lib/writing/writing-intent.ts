/**
 * Composable writing intent — the one contract a workflow uses to ask the shared writing pipeline
 * for an artifact.
 *
 * A workflow supplies *intent*: who is receiving, what the workflow is trying to achieve, which
 * evidence is allowed to become fact, which represented target and surface it is for. It does not
 * supply voice, Personality, audit, approval, or lineage — the server owns those, exactly as it
 * does for the Platform-native writing template. The workflow's only Personality input is the
 * active `bindingId` (see `WRITING_INTENT_PERSONALITY_SUBMISSION_KEYS`).
 *
 * Two shapes, because a brief is written before a run starts and a request is made during it:
 * - `WritingIntentDraft` — what a template config or brief can express (no `bindingId` yet).
 * - `WritingIntent` — the runtime request, carrying the `bindingId` the agent read from
 *   `get_writing_context`.
 *
 * `resolveWritingRequest` turns an intent plus observed Personality/target state into a
 * `WritingRequest`: an explicit lane, an explicit capability, and an explicit refusal reason when
 * the intent must fail closed.
 */

import { z } from "zod";
import { PLATFORMS, type Platform } from "@/lib/db/platforms";
import { RELATIONSHIP_GOAL_ENUM, type RelationshipGoal } from "@/lib/relationship-goals";
import { getSurfaceCapabilities, type PublishCapability } from "@/lib/writing/capabilities";
import { SURFACE_IDS, type SurfaceId } from "@/lib/writing/surfaces";

export const WRITING_INTENT_SCHEMA_VERSION = 1;

/**
 * The only legal mandate for workflow-composed writing.
 *
 * Deliberately one value, pinned by a static test, for the same reason `PRESENCE_MANDATE_MODES`
 * is (#377, ADR D12): the direction is agentic presence, and no workflow may reach external action
 * by widening an enum. Adding a mode requires an ADR.
 */
export const WRITING_INTENT_MANDATES = ["assist_only"] as const;
export type WritingIntentMandate = (typeof WRITING_INTENT_MANDATES)[number];

/** What an `assist_only` intent may ask for. Publishing and sending are absent by construction. */
export const WRITING_INTENT_ACTIONS = ["draft", "audit", "propose"] as const;
export type WritingIntentAction = (typeof WRITING_INTENT_ACTIONS)[number];

/**
 * Approval policy an `assist_only` intent pins.
 *
 * The workspace-level `auto_low_risk` policy must not reach a proposal a human never asked for,
 * so the intent pins `explicit` and the pipeline honours the stricter of the two.
 */
export const WRITING_INTENT_APPROVAL_POLICY = "explicit" as const;

/** The complete set of Personality fields a workflow may submit. Everything else is server-derived. */
export const WRITING_INTENT_PERSONALITY_SUBMISSION_KEYS = ["bindingId"] as const;

/**
 * Workflows allowed to compose writing.
 *
 * Closed on purpose: an unknown consumer fails closed instead of inheriting the writing pipeline by
 * accident. Opting a workflow in means adding it here plus its allowed surfaces —
 * see `docs/composable-writing-intent.md`.
 */
export const WRITING_INTENT_CONSUMERS = ["contact_relationship_nurture"] as const;
export type WritingIntentConsumer = (typeof WRITING_INTENT_CONSUMERS)[number];

/** Surfaces the nurture consumer may propose on. Every one is draft/audit-capable and send-less. */
export const NURTURE_WRITING_SURFACES = [
  "x/reply",
  "x/direct_message",
  "linkedin/comment",
  "linkedin/direct_message",
  "facebook/comment",
  "facebook/direct_message",
] as const satisfies readonly SurfaceId[];

export const WRITING_INTENT_CONSUMER_SURFACES: Record<
  WritingIntentConsumer,
  readonly SurfaceId[]
> = {
  contact_relationship_nurture: NURTURE_WRITING_SURFACES,
};

/**
 * Contact fields an intent may reference.
 *
 * References, not prose: the agent reads persona detail through `get_contact` at draft time, so no
 * CRM body text is persisted into writing lineage, and nothing here can be mistaken for Personality.
 */
export const WRITING_INTENT_RECIPIENT_KEYS = [
  "kind",
  "contactId",
  "platform",
  "handle",
] as const;

const platformSchema = z.enum(PLATFORMS);
const surfaceSchema = z.enum(SURFACE_IDS);
const intentId = z.string().regex(/^wint_[A-Za-z0-9_-]{6,}$/, "invalid writing intent id");

export const writingIntentRecipientSchema = z
  .object({
    kind: z.literal("contact"),
    contactId: z.string().min(1),
    platform: platformSchema,
    handle: z.string().min(1).optional(),
  })
  .strict();

export const writingIntentGoalSchema = z
  .object({
    kind: z.literal("relationship_goal"),
    id: z.enum(RELATIONSHIP_GOAL_ENUM),
    /** Goal the writing spine is scored against; the workflow goal stays the source of intent. */
    writingGoal: z.enum(["replies", "reposts", "saves", "likes", "follows", "clicks", "leads", "awareness"]),
  })
  .strict();

export const writingIntentSourceRefSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("content_item"), contentItemId: z.string().min(1) }).strict(),
  z.object({ kind: z.literal("url"), url: z.string().url() }).strict(),
  z.object({ kind: z.literal("contact_record"), contactId: z.string().min(1) }).strict(),
]);

export const writingIntentTargetSchema = z
  .object({
    platform: platformSchema,
    /** `platform_targets.id` of the represented acting profile, or null when none is bound yet. */
    targetId: z.string().min(1).nullable(),
  })
  .strict();

export const writingIntentReplyContextSchema = z
  .object({
    kind: z.enum(["post", "comment", "thread", "profile"]),
    url: z.string().url().optional(),
    platformPostId: z.string().min(1).optional(),
  })
  .strict();

export const writingIntentLineageSchema = z
  .object({
    workflowRunId: z.string().min(1),
    templateId: z.string().min(1),
    templateName: z.string().min(1).optional(),
    taskId: z.string().min(1).optional(),
  })
  .strict();

const writingIntentShape = {
  schemaVersion: z.literal(WRITING_INTENT_SCHEMA_VERSION),
  intentId,
  mandate: z.enum(WRITING_INTENT_MANDATES),
  actions: z.array(z.enum(WRITING_INTENT_ACTIONS)).min(1),
  consumer: z.enum(WRITING_INTENT_CONSUMERS),
  lineage: writingIntentLineageSchema,
  recipient: writingIntentRecipientSchema.nullable(),
  goal: writingIntentGoalSchema,
  target: writingIntentTargetSchema,
  surface: surfaceSchema,
  replyContext: writingIntentReplyContextSchema.nullable(),
  sourceRefs: z.array(writingIntentSourceRefSchema).max(10),
  approvalPolicy: z.literal(WRITING_INTENT_APPROVAL_POLICY),
};

function refineIntent(
  intent: { surface: SurfaceId; target: { platform: Platform }; consumer: WritingIntentConsumer },
  ctx: z.RefinementCtx,
): void {
  if (!intent.surface.startsWith(`${intent.target.platform}/`)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["surface"],
      message: "surface must belong to the target platform",
    });
  }
  if (!WRITING_INTENT_CONSUMER_SURFACES[intent.consumer].includes(intent.surface)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["surface"],
      message: `surface is not allowed for consumer ${intent.consumer}`,
    });
  }
}

export const writingIntentDraftSchema = z.object(writingIntentShape).strict().superRefine(refineIntent);

/**
 * Runtime request form: the draft plus the active binding the agent read from the server.
 *
 * Strict, so a workflow that tries to submit a Personality hash, workspace, identity, or target
 * representation alongside the binding is rejected rather than silently trusted.
 */
export const writingIntentSchema = z
  .object({ ...writingIntentShape, bindingId: z.string().min(1) })
  .strict()
  .superRefine(refineIntent);

/**
 * What is persisted on a variant (`metadata.writing.intent`).
 *
 * `bindingId` is omitted on purpose: the variant's Personality authority is the server-stamped
 * `writing.personality` snapshot, and a second binding claim carried by the workflow is exactly how
 * lineage would start pooling across bindings.
 */
export const writingIntentRecordSchema = writingIntentDraftSchema;

export type WritingIntentDraft = z.infer<typeof writingIntentDraftSchema>;
export type WritingIntent = z.infer<typeof writingIntentSchema>;
export type WritingIntentRecord = z.infer<typeof writingIntentRecordSchema>;
export type WritingIntentRecipient = z.infer<typeof writingIntentRecipientSchema>;
export type WritingIntentSourceRef = z.infer<typeof writingIntentSourceRefSchema>;

export type WritingIntentRefusal =
  | "personality_host_unavailable"
  | "personality_workspace_unavailable"
  | "personality_drifted"
  | "personality_unbound"
  | "target_identity_mismatch"
  | "surface_draft_unsupported"
  | "invalid_intent";

export type WritingRequest =
  | {
      lane: "full";
      intent: WritingIntent;
      /** Everything the workflow may submit about Personality. */
      personalitySubmission: { bindingId: string };
      capability: {
        /** Honest surface capability, reported even though the mandate overrides it. */
        publish: PublishCapability;
        deliverable: "draft_only";
        /**
         * Why the deliverable is draft-only.
         *
         * Always the mandate, never the surface: a publish-capable surface added to a consumer
         * later must not silently become sendable, so the reason does not depend on the
         * capability table.
         */
        publishBlockedBy: "assist_only_mandate";
      };
      /** `source_stale` still drafts, but carries its warning and needs fresh explicit approval. */
      personalityWarning: "source_stale" | null;
      approvalPolicy: typeof WRITING_INTENT_APPROVAL_POLICY;
    }
  | { lane: "refused"; intent: WritingIntent | null; reason: WritingIntentRefusal };

export type WritingIntentContext = {
  /** `get_writing_context.personality.status`. */
  personalityStatus: "bound" | "source_stale" | "unbound" | "drifted" | "unavailable";
  /** `get_writing_context.personality.host.capability`. */
  hostCapability: "available" | "unavailable" | "unknown";
  /** Whether `intent.target.targetId` represents the active Personality. */
  targetCompatible: boolean;
};

function refuse(intent: WritingIntent | null, reason: WritingIntentRefusal): WritingRequest {
  return { lane: "refused", intent, reason };
}

/**
 * Resolve an intent against observed Personality and target state.
 *
 * Fails closed: anything short of a usable binding, a drawable surface, and a compatible declared
 * target refuses before drafting, so no unapproved artifact reaches audit, approval, or
 * materialization.
 */
export function resolveWritingRequest(
  intent: unknown,
  context: WritingIntentContext,
): WritingRequest {
  const parsed = writingIntentSchema.safeParse(intent);
  if (!parsed.success) return refuse(null, "invalid_intent");
  const request = parsed.data;

  if (context.hostCapability !== "available") {
    return refuse(request, "personality_host_unavailable");
  }
  if (context.personalityStatus === "unavailable") {
    return refuse(request, "personality_workspace_unavailable");
  }
  if (context.personalityStatus === "drifted") return refuse(request, "personality_drifted");
  if (context.personalityStatus === "unbound") return refuse(request, "personality_unbound");

  const capabilities = getSurfaceCapabilities(request.surface);
  if (capabilities.draft !== "supported" || capabilities.audit !== "supported") {
    return refuse(request, "surface_draft_unsupported");
  }
  if (request.target.targetId && !context.targetCompatible) {
    return refuse(request, "target_identity_mismatch");
  }

  return {
    lane: "full",
    intent: request,
    personalitySubmission: { bindingId: request.bindingId },
    capability: {
      publish: capabilities.publish,
      deliverable: "draft_only",
      publishBlockedBy: "assist_only_mandate",
    },
    personalityWarning: context.personalityStatus === "source_stale" ? "source_stale" : null,
    approvalPolicy: WRITING_INTENT_APPROVAL_POLICY,
  };
}

/** Strip a runtime intent down to what may be persisted on a variant. */
export function toWritingIntentRecord(intent: WritingIntent): WritingIntentRecord {
  const { bindingId: _bindingId, ...record } = intent;
  return writingIntentRecordSchema.parse(record);
}

export function readWritingIntentRecord(value: unknown): WritingIntentRecord | null {
  const parsed = writingIntentRecordSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** True when a persisted artifact was produced under a mandate that forbids external action. */
export function isAssistOnlyIntent(value: unknown): boolean {
  const record = readWritingIntentRecord(value);
  return record?.mandate === "assist_only";
}

export function buildWritingIntentDraft(input: {
  intentId: string;
  consumer: WritingIntentConsumer;
  lineage: z.infer<typeof writingIntentLineageSchema>;
  recipient: WritingIntentRecipient | null;
  goal: { relationshipGoal: RelationshipGoal; writingGoal: WritingIntentDraft["goal"]["writingGoal"] };
  target: { platform: Platform; targetId: string | null };
  surface: SurfaceId;
  replyContext?: z.infer<typeof writingIntentReplyContextSchema> | null;
  sourceRefs?: WritingIntentSourceRef[];
  actions?: WritingIntentAction[];
}): WritingIntentDraft {
  return writingIntentDraftSchema.parse({
    schemaVersion: WRITING_INTENT_SCHEMA_VERSION,
    intentId: input.intentId,
    mandate: "assist_only",
    actions: input.actions ?? ["draft", "audit", "propose"],
    consumer: input.consumer,
    lineage: input.lineage,
    recipient: input.recipient,
    goal: {
      kind: "relationship_goal",
      id: input.goal.relationshipGoal,
      writingGoal: input.goal.writingGoal,
    },
    target: input.target,
    surface: input.surface,
    replyContext: input.replyContext ?? null,
    sourceRefs: input.sourceRefs ?? [],
    approvalPolicy: WRITING_INTENT_APPROVAL_POLICY,
  });
}
