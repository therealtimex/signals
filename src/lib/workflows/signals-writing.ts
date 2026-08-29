import { PLATFORMS, type Platform } from "@/lib/db/platforms";
import { getSurfaceCapabilities } from "@/lib/writing/capabilities";
import { parseSurfaceId, type SurfaceId } from "@/lib/writing/surfaces";

export const WRITING_CONFIG_KEY = "signalsWriting";

export const WRITING_GOALS = [
  "replies",
  "reposts",
  "saves",
  "likes",
  "follows",
  "clicks",
  "leads",
  "awareness",
] as const;

export type WritingGoal = (typeof WRITING_GOALS)[number];

export interface WritingTemplateConfig {
  version: 1;
  launchId?: string;
  goal: WritingGoal;
  surfaces: { platform: Platform; surface: SurfaceId; targetId?: string }[];
  sourceContentItemIds: string[];
  sourceUrls: string[];
  instructions: string;
  voiceProfileId: string | "active" | null;
  voicePrecedence: "voice_first" | "rules_first";
  mode: "draft" | "adapt";
  adaptFromContentItemId?: string;
  requireApproval: true;
}

function isStringArray(value: unknown, max: number): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= max &&
    value.every((entry) => typeof entry === "string" && Boolean(entry.trim()))
  );
}

export function readSignalsWritingTemplateConfig(
  config: Record<string, unknown>,
): WritingTemplateConfig | null {
  const raw = config[WRITING_CONFIG_KEY];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const candidate = raw as Record<string, unknown>;
  const surfaces = Array.isArray(candidate.surfaces) ? candidate.surfaces : null;
  if (
    candidate.version !== 1 ||
    !(WRITING_GOALS as readonly unknown[]).includes(candidate.goal) ||
    !surfaces ||
    surfaces.length > 6 ||
    !surfaces.every((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) return false;
      const row = entry as Record<string, unknown>;
      const surface = parseSurfaceId(row.surface);
      return (
        typeof row.platform === "string" &&
        (PLATFORMS as readonly string[]).includes(row.platform) &&
        surface !== null &&
        surface.startsWith(`${row.platform}/`) &&
        (row.targetId === undefined ||
          (typeof row.targetId === "string" && Boolean(row.targetId.trim())))
      );
    }) ||
    !isStringArray(candidate.sourceContentItemIds, 20) ||
    !isStringArray(candidate.sourceUrls, 10) ||
    typeof candidate.instructions !== "string" ||
    candidate.instructions.length > 4_000 ||
    !(
      candidate.voiceProfileId === null ||
      (typeof candidate.voiceProfileId === "string" && Boolean(candidate.voiceProfileId.trim()))
    ) ||
    (candidate.voicePrecedence !== "voice_first" &&
      candidate.voicePrecedence !== "rules_first") ||
    (candidate.mode !== "draft" && candidate.mode !== "adapt") ||
    candidate.requireApproval !== true ||
    (candidate.launchId !== undefined &&
      (typeof candidate.launchId !== "string" || !candidate.launchId.trim())) ||
    (candidate.adaptFromContentItemId !== undefined &&
      (typeof candidate.adaptFromContentItemId !== "string" ||
        !candidate.adaptFromContentItemId.trim())) ||
    (candidate.mode === "adapt" &&
      (typeof candidate.adaptFromContentItemId !== "string" ||
        !candidate.adaptFromContentItemId.trim()))
  ) {
    return null;
  }
  return candidate as unknown as WritingTemplateConfig;
}

export function isSignalsWritingTemplateConfig(config: Record<string, unknown>): boolean {
  return readSignalsWritingTemplateConfig(config) !== null;
}

export function buildWritingTemplateConfig(
  patch: Partial<WritingTemplateConfig> = {},
): Record<string, unknown> {
  return {
    [WRITING_CONFIG_KEY]: {
      version: 1,
      goal: "awareness",
      surfaces: [],
      sourceContentItemIds: [],
      sourceUrls: [],
      instructions: "",
      voiceProfileId: null,
      voicePrecedence: "voice_first",
      mode: "draft",
      requireApproval: true,
      ...patch,
    },
  };
}

export function buildWritingBriefSection(input: {
  template: { id: string; name: string };
  config: Record<string, unknown>;
  workflowRunId: string;
  signalsBaseUrl: string;
}): string {
  const writing = readSignalsWritingTemplateConfig(input.config);
  if (!writing) return "";
  const capabilityRows = writing.surfaces.length
    ? writing.surfaces.map(({ platform, surface, targetId }) => {
        const capability = getSurfaceCapabilities(surface);
        return `- ${surface} (platform=${platform}${targetId ? `, target=${targetId}` : ""}): draft=${capability.draft}, audit=${capability.audit}, export=${capability.export}, publish=${capability.publish}, metrics=${capability.metrics}`;
      })
    : ["- No surfaces configured — stop and ask the operator which platform-native surfaces to draft."];

  return [
    "Signals Writing execution contract:",
    "0. Load the signals-writing workspace skill (.claude/skills/signals-writing/SKILL.md) and use its scripts/writing-cli.cjs for ids, unit measurement, verdicts, and prechecks.",
    `Template: ${input.template.name} (${input.template.id})`,
    `Workflow run: ${input.workflowRunId}`,
    `Signals base URL: ${input.signalsBaseUrl}`,
    "Writing config:",
    "```json",
    JSON.stringify(writing, null, 2),
    "```",
    "Capability truth:",
    ...capabilityRows,
    "Tool sequence:",
    `1. Call get_writing_context with launchId=${writing.launchId ?? "<create a launch from the operator brief first>"} and the configured surfaces. Treat its redactions and capability rows as authoritative.`,
    "2. Call get_content only for explicit content-item sources; a private body is usable only when the persisted launch source grants context approval.",
    "3. Use list_voice_profiles/get_voice_profile for existing voice. Register new immutable content with upsert_voice_profile; only approve_voice_profile may activate it, and only with real user evidence.",
    "4. Persist the validated launch spine with upsert_launch, preserving every source hash, claim reference, and approval. Never put redacted source text back into the spine.",
    "5. Draft and audit one platform-native artifact per surface, then call upsert_variant with generationMetadata.kind=signals-writing and the complete metadata.writing contract. In-place revisions reuse the returned variant id; new derived alternatives omit id and carry the source variant in writing lineage.",
    "6. Read lineageEdges from the persisted variant response. Use query_graph from the variant ID only when verifying a real derived, adapted, sourced-content, materialized, or published edge; launch membership remains variant.launchId.",
    "7. Call materialize_variant only after the server-validated audit passes. Under explicit policy include user approval evidence; do not manufacture it. Use revoke_variant_approval when the user withdraws approval.",
    "8. Call complete_workflow_run with the variant/content IDs and any missing surfaces or blockers.",
    "Hard rules:",
    "- Use only manifest-backed agent tools; do not call removed in-process helpers or lib wrappers.",
    "- Do not write a content item directly for a variant; materialize_variant owns that boundary.",
    "- Do not introduce a fact, number, date, name, quote, or citation absent from the source spine.",
    "- Do not use an unapproved voice profile or derive voice from AI-generated or third-party text.",
    "- Do not scrub protected quirks under voice-first precedence.",
    "- Describe non-direct/non-beta capability honestly as draft/export only.",
    "- Do not use platform-manipulation tactics, engagement bait, or detector gaming.",
    "- Do not approve on the operator's behalf under explicit policy.",
    "- Do not publish; publishing is a separate explicit instruction executed by signals-publish.",
  ].join("\n");
}
