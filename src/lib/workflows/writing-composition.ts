/**
 * The reusable opt-in that attaches the shared writing contract to a workflow.
 *
 * Before #410 the only way a brief could carry the writing contract was
 * `isSignalsWritingTemplateConfig` — so any workflow that wanted Personality-bound voice had to
 * *become* the Platform-native writing template, or fork the instructions. This key is the third
 * option: a workflow declares which consumer it is and which surfaces it may propose on, and the
 * shared pipeline supplies everything else.
 *
 * Opting a new workflow in is two edits and no new engine: add it to `WRITING_INTENT_CONSUMERS`
 * with its allowed surfaces, then put `buildWritingIntentCompositionConfig(...)` in its template
 * config. See `docs/composable-writing-intent.md`.
 */

import { parseSurfaceId, type SurfaceId } from "@/lib/writing/surfaces";
import {
  WRITING_INTENT_APPROVAL_POLICY,
  WRITING_INTENT_CONSUMERS,
  WRITING_INTENT_CONSUMER_SURFACES,
  WRITING_INTENT_SCHEMA_VERSION,
  type WritingIntentConsumer,
} from "@/lib/writing/writing-intent";
import {
  WRITING_HARD_RULES,
  WRITING_LANE_DRIFTED_STEP,
  WRITING_LANE_GATE_STEP,
  WRITING_LANE_REVISION_STEP,
  WRITING_LINEAGE_STEP,
  WRITING_PERSONALITY_FILES_STEP,
  WRITING_SKILL_LOAD_STEP,
  WRITING_SOURCE_STEPS,
  buildWritingCapabilityRows,
  buildWritingLaneBoundStep,
} from "@/lib/workflows/writing-contract";

export const WRITING_INTENT_CONFIG_KEY = "writingIntent";
export const WRITING_INTENT_CONFIG_VERSION = 1;

export interface WritingIntentComposition {
  version: typeof WRITING_INTENT_CONFIG_VERSION;
  consumer: WritingIntentConsumer;
  /** Surfaces this workflow may propose on; always a subset of the consumer's allowed surfaces. */
  surfaces: SurfaceId[];
  mandate: "assist_only";
  approvalPolicy: typeof WRITING_INTENT_APPROVAL_POLICY;
}

export function readWritingIntentComposition(
  config: Record<string, unknown>,
): WritingIntentComposition | null {
  const raw = config[WRITING_INTENT_CONFIG_KEY];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const candidate = raw as Record<string, unknown>;
  if (candidate.version !== WRITING_INTENT_CONFIG_VERSION) return null;
  if (
    typeof candidate.consumer !== "string" ||
    !(WRITING_INTENT_CONSUMERS as readonly string[]).includes(candidate.consumer)
  ) {
    return null;
  }
  const consumer = candidate.consumer as WritingIntentConsumer;
  const allowed = WRITING_INTENT_CONSUMER_SURFACES[consumer];
  if (!Array.isArray(candidate.surfaces) || candidate.surfaces.length === 0) return null;
  const surfaces: SurfaceId[] = [];
  for (const entry of candidate.surfaces) {
    const surface = parseSurfaceId(entry);
    if (!surface || !allowed.includes(surface)) return null;
    surfaces.push(surface);
  }
  if (candidate.mandate !== "assist_only") return null;
  if (candidate.approvalPolicy !== WRITING_INTENT_APPROVAL_POLICY) return null;
  return { version: WRITING_INTENT_CONFIG_VERSION, consumer, surfaces, mandate: "assist_only", approvalPolicy: WRITING_INTENT_APPROVAL_POLICY };
}

export function isWritingComposedConfig(config: Record<string, unknown>): boolean {
  return readWritingIntentComposition(config) !== null;
}

export function buildWritingIntentCompositionConfig(input: {
  consumer: WritingIntentConsumer;
  surfaces?: readonly SurfaceId[];
}): Record<string, unknown> {
  return {
    [WRITING_INTENT_CONFIG_KEY]: {
      version: WRITING_INTENT_CONFIG_VERSION,
      consumer: input.consumer,
      surfaces: [...(input.surfaces ?? WRITING_INTENT_CONSUMER_SURFACES[input.consumer])],
      mandate: "assist_only",
      approvalPolicy: WRITING_INTENT_APPROVAL_POLICY,
    },
  };
}

/**
 * The composed writing execution contract.
 *
 * Identical Personality gate, source rules, lane gate, lineage step, and hard rules as the
 * Platform-native lane; what differs is the deliverable (a writing intent per touchpoint), the
 * absence of an unbound sketch lane, and an approval step that never mentions `auto_low_risk`.
 */
export function buildComposedWritingBriefSection(input: {
  composition: WritingIntentComposition;
  templateId: string;
  templateName: string;
  workflowRunId: string;
  signalsBaseUrl: string;
  target: { platform: string; targetId: string | null };
}): string {
  const capabilityRows = buildWritingCapabilityRows(
    input.composition.surfaces.map((surface) => ({
      platform: surface.split("/")[0],
      surface,
      ...(input.target.targetId && surface.startsWith(`${input.target.platform}/`)
        ? { targetId: input.target.targetId }
        : {}),
    })),
    "No surfaces configured — stop and ask the operator which surfaces this workflow may propose on.",
  );

  const intentTemplate = {
    schemaVersion: WRITING_INTENT_SCHEMA_VERSION,
    intentId: "wint_<generated>",
    mandate: "assist_only",
    actions: ["draft", "audit", "propose"],
    consumer: input.composition.consumer,
    lineage: {
      workflowRunId: input.workflowRunId,
      templateId: input.templateId,
      templateName: input.templateName,
    },
    recipient: { kind: "contact", contactId: "<contactId>", platform: "<platform>", handle: "<handle>" },
    goal: { kind: "relationship_goal", id: "<relationshipGoal>", writingGoal: "<writingGoal>" },
    target: { platform: input.target.platform, targetId: input.target.targetId },
    surface: input.composition.surfaces[0],
    replyContext: { kind: "post", url: "<url of the post being answered>" },
    sourceRefs: [{ kind: "contact_record", contactId: "<contactId>" }],
    approvalPolicy: WRITING_INTENT_APPROVAL_POLICY,
  };

  return [
    "Shared writing-intent contract:",
    WRITING_SKILL_LOAD_STEP,
    `Consumer: ${input.composition.consumer} (mandate=${input.composition.mandate}, approvalPolicy=${input.composition.approvalPolicy})`,
    `Template: ${input.templateName} (${input.templateId})`,
    `Workflow run: ${input.workflowRunId}`,
    `Signals base URL: ${input.signalsBaseUrl}`,
    "This workflow does not write its own voice, audit, approval, or lineage rules. It supplies intent; Signals owns the rest.",
    "Writing intent template — build one per touchpoint and attach it as `metadata.writing.intent` on upsert_variant:",
    "```json",
    JSON.stringify(intentTemplate, null, 2),
    "```",
    "Capability truth:",
    ...capabilityRows,
    "Tool sequence:",
    WRITING_PERSONALITY_FILES_STEP,
    "2. Call get_writing_context with the launch you create for this run and the intent surfaces. Treat its redactions and capability rows as authoritative.",
    ...WRITING_SOURCE_STEPS,
    WRITING_LANE_GATE_STEP,
    buildWritingLaneBoundStep({
      deliverable: "draft one artifact per writing intent",
      extraContract: "the `metadata.writing.intent` record",
    }),
    "   - For `unbound`, refuse: a workflow proposal speaks as the workspace Personality, so there is no legacy-unbound sketch lane here. Report the persisted status and stop.",
    WRITING_LANE_DRIFTED_STEP,
    WRITING_LANE_REVISION_STEP,
    WRITING_LINEAGE_STEP,
    "8. Render the persisted approval card after audit and precheck, then wait for fresh explicit user approval and call `materialize_variant` with the real user evidence. `auto_low_risk` does not apply to composed proposals — the mandate pins `explicit`, and Signals rejects a policy approval on these artifacts.",
    "   Never manufacture approval evidence. Use `revoke_variant_approval` when the user withdraws approval.",
    "9. Call complete_workflow_run with the variant/content IDs and any refused or blocked intents.",
    "Recipient boundary:",
    "- Workspace Personality answers \"who is speaking\". Contact data answers \"who is receiving and what is relevant\".",
    "- Read recipient context with get_contact; never copy contact facts, persona attributes, relationship notes, or private CRM fields into IDENTITY.md, SOUL.md, VOICE.md, or BRAND.md.",
    "- Only `sourceRefs` evidence may become a fact in the artifact; recipient context selects relevance, it does not create authority.",
    ...WRITING_HARD_RULES,
    `- Do not publish, send, comment, reply, schedule, or open a publish job from this workflow; ${input.composition.mandate} means draft, audit, and propose only.`,
  ].join("\n");
}
