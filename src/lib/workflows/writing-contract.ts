/**
 * The shared writing execution contract every writing-capable workflow emits.
 *
 * Both lanes — the Platform-native writing template and any workflow that opts in with a writing
 * intent — render the *same* Personality gate, voice resolution, lane selection, and hard rules from
 * here. That is the mechanism behind "one workspace Personality, one speaker voice": the deliverable
 * sentence differs per lane, the identity rules cannot.
 *
 * Only `buildWritingBriefSection` (Platform-native) and `buildComposedWritingBriefSection`
 * (composed) should assemble these; a workflow that writes its own Personality instructions has
 * forked the contract, which is exactly what #410 removes.
 */

import { getSurfaceCapabilities } from "@/lib/writing/capabilities";
import type { SurfaceId } from "@/lib/writing/surfaces";

export const WRITING_SKILL_LOAD_STEP =
  "0. Load the signals-writing workspace skill (.claude/skills/signals-writing/SKILL.md) and use its scripts/writing-cli.cjs for ids, unit measurement, verdicts, and prechecks.";

export const WRITING_PERSONALITY_FILES_STEP =
  "1. Read the workspace Personality files (IDENTITY.md, SOUL.md, VOICE.md, BRAND.md) first. Treat both get_writing_context.personality.status and get_writing_context.personality.host.capability as the binding gate; bound work submits only its active bindingId.";

export const WRITING_SOURCE_STEPS = [
  "3. Call get_content only for explicit content-item sources; a private body is usable only when the persisted launch source grants context approval.",
  "4. Use list_voice_profiles/get_voice_profile for existing voice. Register new immutable content with upsert_voice_profile; only approve_voice_profile may activate it, and only with real user evidence.",
  "5. Persist the validated launch spine with upsert_launch, preserving every source hash, claim reference, and approval. Never put redacted source text back into the spine.",
] as const;

export const WRITING_LANE_GATE_STEP =
  "6. Gate on both persisted Personality fields before selecting a lane. If `get_writing_context.personality.host.capability` is not `available`, refuse Personality-required writing and report the persisted host capability and Personality status. Otherwise persist by `get_writing_context.personality.status`:";

export const WRITING_LANE_UNBOUND_STEP =
  "   - For `unbound`, create only a targetless, unaudited sketch: run `measure`; omit `metadata.writing.targetId` and `metadata.writing.personality`; send `metadata.writing.audit: null`; set the top-level `label` suffix to `legacy_unbound sketch`; call `upsert_variant`; re-read `get_writing_context` and confirm the selected `variants[].personalityState` is `legacy_unbound`. Stop before audit, verdict, precheck, approval, materialization, export, or publish.";

export const WRITING_LANE_DRIFTED_STEP =
  "   - For `drifted`/`unavailable`, refuse Personality-required writing and report the persisted state; never repair drift by editing Personality files.";

export const WRITING_LANE_REVISION_STEP =
  "   In-place revisions reuse the returned variant id; new derived alternatives omit id and carry the source variant in writing lineage.";

export const WRITING_LINEAGE_STEP =
  "7. Read lineageEdges from the persisted variant response. Use query_graph from the variant ID only when verifying a real derived, adapted, sourced-content, materialized, or published edge; launch membership remains variant.launchId.";

export const WRITING_HARD_RULES = [
  "Hard rules:",
  "- Use only manifest-backed agent tools; do not call removed in-process helpers or lib wrappers.",
  "- Do not write a content item directly for a variant; materialize_variant owns that boundary.",
  "- Do not introduce a fact, number, date, name, quote, or citation absent from the source spine.",
  "- Do not use an unapproved voice profile or derive voice from AI-generated or third-party text.",
  "- Do not edit workspace Personality files; Personality changes are proposals approved by the user.",
  "- Do not scrub protected quirks under voice-first precedence.",
  "- Describe non-direct/non-beta capability honestly as draft/export only.",
  "- Do not use platform-manipulation tactics, engagement bait, or detector gaming.",
  "- Do not approve on the operator's behalf under explicit policy.",
  "- Do not publish; publishing is a separate explicit instruction executed by signals-publish.",
] as const;

/**
 * The bound/source-stale lane line.
 *
 * `deliverable` is the only part a lane may vary — what artifact to produce. The binding, audit,
 * verdict, precheck, and `bindingId` submission rules are fixed for every caller.
 */
export function buildWritingLaneBoundStep(input: {
  deliverable: string;
  extraContract?: string;
}): string {
  return `   - For \`bound\`/\`source_stale\`, ${input.deliverable}, run \`measure\`, create the structured audit, run \`verdict\` then \`precheck\`, and call \`upsert_variant\` with \`generationMetadata.kind=signals-writing\`, the complete \`metadata.writing\` contract,${input.extraContract ? ` ${input.extraContract},` : ""} and only the current \`bindingId\`. \`source_stale\` remains a full lane with its persisted warning and requires fresh explicit approval before materialization.`;
}

/** Honest per-surface capability rows, so a lane never implies a send path it does not have. */
export function buildWritingCapabilityRows(
  surfaces: readonly { platform: string; surface: SurfaceId; targetId?: string }[],
  emptyNotice: string,
): string[] {
  if (!surfaces.length) return [`- ${emptyNotice}`];
  return surfaces.map(({ platform, surface, targetId }) => {
    const capability = getSurfaceCapabilities(surface);
    return `- ${surface} (platform=${platform}${targetId ? `, target=${targetId}` : ""}): draft=${capability.draft}, audit=${capability.audit}, export=${capability.export}, publish=${capability.publish}, metrics=${capability.metrics}`;
  });
}
