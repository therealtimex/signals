import { PLATFORMS, type Platform } from "@/lib/db/platforms";
import { parseSurfaceId, type SurfaceId } from "@/lib/writing/surfaces";
import {
  WRITING_HARD_RULES,
  WRITING_LANE_DRIFTED_STEP,
  WRITING_LANE_GATE_STEP,
  WRITING_LANE_REVISION_STEP,
  WRITING_LANE_UNBOUND_STEP,
  WRITING_LINEAGE_STEP,
  WRITING_PERSONALITY_FILES_STEP,
  WRITING_SKILL_LOAD_STEP,
  WRITING_SOURCE_STEPS,
  buildWritingCapabilityRows,
  buildWritingLaneBoundStep,
} from "@/lib/workflows/writing-contract";

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
  const capabilityRows = buildWritingCapabilityRows(
    writing.surfaces,
    "No surfaces configured — stop and ask the operator which platform-native surfaces to draft.",
  );

  return [
    "Signals Writing execution contract:",
    WRITING_SKILL_LOAD_STEP,
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
    WRITING_PERSONALITY_FILES_STEP,
    `2. Call get_writing_context with launchId=${writing.launchId ?? "<create a launch from the operator brief first>"} and the configured surfaces. Treat its redactions and capability rows as authoritative.`,
    ...WRITING_SOURCE_STEPS,
    WRITING_LANE_GATE_STEP,
    buildWritingLaneBoundStep({ deliverable: "draft one platform-native artifact per surface" }),
    WRITING_LANE_UNBOUND_STEP,
    WRITING_LANE_DRIFTED_STEP,
    WRITING_LANE_REVISION_STEP,
    WRITING_LINEAGE_STEP,
    "8. In the `bound`/`source_stale` full lane only, render the persisted approval card after audit and precheck, then follow `get_writing_context.approvalPolicy` and the selected variant's `approvalState`, `riskTier`, and `auditStale`:",
    "   - For `explicit`, `source_stale`, medium/high risk, or `APPROVAL_REQUIRED`, wait for fresh explicit user approval and call `materialize_variant` with the real user evidence.",
    "   - For `auto_low_risk`, call `materialize_variant` without a user approval payload only when the selected variant has `approvalState: approved`, `riskTier: low`, and `auditStale: false`; Signals owns that policy decision.",
    "   Never manufacture approval evidence. Use `revoke_variant_approval` when the user withdraws approval.",
    "9. Call complete_workflow_run with the variant/content IDs and any missing surfaces or blockers.",
    ...WRITING_HARD_RULES,
  ].join("\n");
}
