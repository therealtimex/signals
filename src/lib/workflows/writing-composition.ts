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

import type { SurfaceId } from "@/lib/writing/surfaces";
import {
  WRITING_INTENT_APPROVAL_POLICY,
  WRITING_INTENT_SCHEMA_VERSION,
  type WritingIntentComposition,
} from "@/lib/writing/writing-intent";

// The composition config lives with the contract (`writing-intent.ts`) because the server reads it
// to decide whether a run is composed. Re-exported here so brief-layer callers keep one import.
export {
  WRITING_INTENT_CONFIG_KEY,
  WRITING_INTENT_CONFIG_VERSION,
  buildWritingIntentCompositionConfig,
  isWritingComposedConfig,
  readWritingIntentComposition,
  type WritingIntentComposition,
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

/**
 * The composed writing execution contract.
 *
 * Identical Personality gate, source rules, lane gate, lineage step, and hard rules as the
 * Platform-native lane; what differs is the deliverable (a writing intent per touchpoint), the
 * absence of an unbound sketch lane, and an approval step that never mentions `auto_low_risk`.
 *
 * `target` is the *resolved* acting profile, not a config guess. When one is resolved, only its
 * platform's surfaces are offered — an X sample handed to a LinkedIn run is both wrong advice and
 * an intent `writingIntentDraftSchema` rejects.
 */
export function buildComposedWritingBriefSection(input: {
  composition: WritingIntentComposition;
  templateId: string;
  templateName: string;
  workflowRunId: string;
  signalsBaseUrl: string;
  target: { platform: string; targetId: string | null } | null;
}): string {
  const platform = input.target?.platform.toLowerCase() ?? null;
  const scoped = platform
    ? input.composition.surfaces.filter((surface) => surface.startsWith(`${platform}/`))
    : input.composition.surfaces;

  if (platform && scoped.length === 0) {
    return [
      "Shared writing-intent contract:",
      `Consumer: ${input.composition.consumer} (mandate=${input.composition.mandate})`,
      `Workflow run: ${input.workflowRunId}`,
      `No enabled writing surface exists for the acting platform ${platform}. Report every touchpoint as unsupported, propose nothing, and call complete_workflow_run with that blocker.`,
    ].join("\n");
  }

  const capabilityRows = buildWritingCapabilityRows(
    scoped.map((surface) => ({
      platform: surface.split("/")[0],
      surface,
      ...(input.target?.targetId && surface.startsWith(`${platform}/`)
        ? { targetId: input.target.targetId }
        : {}),
    })),
    "No surfaces configured — stop and ask the operator which surfaces this workflow may propose on.",
  );

  // Keep the sample internally valid: its surface and target platform always agree, because the
  // contract rejects a mismatch and an invalid sample teaches the agent the wrong shape.
  const sampleSurface = scoped[0];
  const samplePlatform = sampleSurface.split("/")[0];

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
    recipient: { kind: "contact", contactId: "<contactId>", platform: "<recipient platform>", handle: "<handle>" },
    goal: { kind: "relationship_goal", id: "<relationshipGoal>", writingGoal: "<writingGoal>" },
    target: { platform: samplePlatform, targetId: input.target?.targetId ?? "<acting platform_targets.id>" },
    surface: sampleSurface,
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
    platform
      ? `Acting platform: ${platform}. Only the surfaces listed below are enabled for this run.`
      : "No acting target is configured. Resolve the acting profile per contact platform, then use only the surfaces below that match it.",
    "This workflow does not write its own voice, audit, approval, or lineage rules. It supplies intent; Signals owns the rest.",
    "Writing intent template — build one per touchpoint and attach it as `metadata.writing.intent` on upsert_variant:",
    "```json",
    JSON.stringify(intentTemplate, null, 2),
    "```",
    "`surface` must belong to `target.platform`, and `lineage` must name this workflow run and template — Signals resolves the composition from the run record and rejects a mismatch.",
    "Capability truth:",
    ...capabilityRows,
    "Tool sequence:",
    WRITING_PERSONALITY_FILES_STEP,
    `2. Create this run's launch with upsert_launch, and put this workflow run in its \`writing.runs\` — \`runs: [{ workflowRunId: "${input.workflowRunId}", mode: "draft", startedAt: <unix> }]\`. That is what binds the launch to this dispatch: Signals stamps a server-owned composition scope from it, and every proposal on that launch is validated against the scope. A launch without it cannot carry a proposal. Then call get_writing_context with that launch and the intent surfaces, and treat its redactions and capability rows as authoritative.`,
    ...WRITING_SOURCE_STEPS,
    WRITING_LANE_GATE_STEP,
    buildWritingLaneBoundStep({
      deliverable: "draft one artifact per writing intent",
      extraContract: "the `metadata.writing.intent` record",
    }),
    "   - For `unbound`, refuse: a workflow proposal speaks as the workspace Personality, so there is no legacy-unbound sketch lane here. Report the persisted status and stop.",
    WRITING_LANE_DRIFTED_STEP,
    WRITING_LANE_REVISION_STEP,
    "   A proposal is bound to one recipient and goal. Rebinding an approved proposal to a different contact, relationship goal, or source set stales its audit and revokes approval — build a new intent instead.",
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
