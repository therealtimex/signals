import { describe, expect, it } from "vitest";
import { buildAgentWorkflowBrief } from "@/lib/workflows/template-brief";
import { buildContactNurtureTemplateConfig } from "@/lib/workflows/contact-relationship-nurture";
import {
  buildWritingBriefSection,
  buildWritingTemplateConfig,
} from "@/lib/workflows/signals-writing";
import {
  WRITING_HARD_RULES,
  WRITING_LANE_DRIFTED_STEP,
  WRITING_LANE_GATE_STEP,
  WRITING_LINEAGE_STEP,
  WRITING_PERSONALITY_FILES_STEP,
  WRITING_SKILL_LOAD_STEP,
  WRITING_SOURCE_STEPS,
} from "@/lib/workflows/writing-contract";
import {
  WRITING_INTENT_CONFIG_KEY,
  buildComposedWritingBriefSection,
  buildWritingIntentCompositionConfig,
  isWritingComposedConfig,
  readWritingIntentComposition,
} from "@/lib/workflows/writing-composition";
import { writingIntentDraftSchema } from "@/lib/writing/writing-intent";

const composition = readWritingIntentComposition(
  buildWritingIntentCompositionConfig({ consumer: "contact_relationship_nurture" }),
)!;

function composedFor(target: { platform: string; targetId: string | null } | null): string {
  return buildComposedWritingBriefSection({
    composition,
    templateId: "tpl_1",
    templateName: "Contact Relationship Nurture",
    workflowRunId: "run_1",
    signalsBaseUrl: "http://127.0.0.1:3000",
    target,
  });
}

/** Parse the fenced intent sample the brief hands the agent. */
function sampleIntent(brief: string): Record<string, unknown> {
  const fenced = brief.split("```json\n")[1]?.split("\n```")[0];
  if (!fenced) throw new Error("brief has no intent sample");
  return JSON.parse(fenced) as Record<string, unknown>;
}

const template = {
  id: "tpl_1",
  name: "Contact Relationship Nurture",
  description: "Nurture",
  templateType: "nurture" as const,
  platform: null,
  systemPrompt: "Follow the contract.",
  targetPersona: null,
};

const composed = composedFor({ platform: "x", targetId: "tgt_x" });

const platformNative = buildWritingBriefSection({
  template: { id: "tpl_2", name: "Platform-native writing" },
  config: buildWritingTemplateConfig({
    launchId: "launch_1",
    surfaces: [{ platform: "x", surface: "x/post", targetId: "tgt_x" }],
  }),
  workflowRunId: "run_2",
  signalsBaseUrl: "http://127.0.0.1:3000",
});

describe("writing-intent composition opt-in", () => {
  it("validates the bounded nested config", () => {
    const config = buildWritingIntentCompositionConfig({
      consumer: "contact_relationship_nurture",
    });
    expect(isWritingComposedConfig(config)).toBe(true);
    expect(readWritingIntentComposition(config)?.surfaces).toContain("x/reply");
    expect(isWritingComposedConfig({})).toBe(false);
  });

  it("rejects a widened mandate, policy, or surface", () => {
    const base = buildWritingIntentCompositionConfig({
      consumer: "contact_relationship_nurture",
    })[WRITING_INTENT_CONFIG_KEY] as Record<string, unknown>;
    for (const override of [
      { mandate: "autonomous" },
      { approvalPolicy: "auto_low_risk" },
      { surfaces: ["x/post"] },
      { surfaces: [] },
      { consumer: "profile_publish" },
      { version: 2 },
    ]) {
      expect(
        readWritingIntentComposition({ [WRITING_INTENT_CONFIG_KEY]: { ...base, ...override } }),
      ).toBeNull();
    }
  });
});

describe("composed writing brief", () => {
  it("renders the same Personality, source, and hard rules as the Platform-native lane", () => {
    for (const shared of [
      WRITING_SKILL_LOAD_STEP,
      WRITING_PERSONALITY_FILES_STEP,
      ...WRITING_SOURCE_STEPS,
      WRITING_LANE_GATE_STEP,
      WRITING_LANE_DRIFTED_STEP,
      WRITING_LINEAGE_STEP,
      ...WRITING_HARD_RULES,
    ]) {
      expect(composed).toContain(shared);
      expect(platformNative).toContain(shared);
    }
  });

  it("does not turn the workflow into the Platform-native writing template", () => {
    expect(composed).toContain("Shared writing-intent contract");
    expect(composed).not.toContain("Signals Writing execution contract");
    expect(composed).not.toContain("draft one platform-native artifact per surface");
    expect(composed).toContain("draft one artifact per writing intent");
  });

  it("requires explicit approval and never offers the auto_low_risk bypass", () => {
    expect(composed).toContain("wait for fresh explicit user approval");
    expect(composed).toContain("`auto_low_risk` does not apply to composed proposals");
    expect(composed).not.toContain(
      "call `materialize_variant` without a user approval payload",
    );
    expect(platformNative).toContain("For `auto_low_risk`");
  });

  it("has no legacy-unbound sketch lane", () => {
    expect(composed).toContain("For `unbound`, refuse");
    expect(composed).not.toContain("legacy_unbound sketch");
    expect(platformNative).toContain("legacy_unbound sketch");
  });

  it("reports honest capability rows and forbids external action", () => {
    expect(composed).toContain("x/reply (platform=x, target=tgt_x): draft=supported");
    expect(composed).toContain("publish=draft_only");
    expect(composed).toContain(
      "Do not publish, send, comment, reply, schedule, or open a publish job from this workflow",
    );
  });

  it("offers only the acting platform's surfaces", () => {
    const linkedin = composedFor({ platform: "linkedin", targetId: "tgt_li" });
    expect(linkedin).toContain("linkedin/comment (platform=linkedin, target=tgt_li)");
    expect(linkedin).toContain("linkedin/direct_message");
    expect(linkedin).not.toContain("x/reply");
    expect(linkedin).not.toContain("facebook/comment");
    expect(linkedin).toContain("Acting platform: linkedin");
  });

  it("emits an intent sample the contract actually accepts, on every platform", () => {
    for (const platform of ["x", "linkedin", "facebook"]) {
      const sample = sampleIntent(composedFor({ platform, targetId: `tgt_${platform}` }));
      expect((sample.target as { platform: string }).platform).toBe(platform);
      expect(sample.surface).toMatch(new RegExp(`^${platform}/`));
      const parsed = writingIntentDraftSchema.safeParse({
        ...sample,
        intentId: "wint_sample1",
        recipient: { kind: "contact", contactId: "contact_1", platform },
        goal: { kind: "relationship_goal", id: "follow_back", writingGoal: "follows" },
        replyContext: null,
        sourceRefs: [],
      });
      expect(parsed.success).toBe(true);
    }
  });

  it("does not guess a platform when no acting target is resolved", () => {
    const unresolved = composedFor(null);
    expect(unresolved).toContain("No acting target is configured");
    expect(unresolved).toContain("x/reply");
    expect(unresolved).toContain("linkedin/comment");
    expect(unresolved).toContain("facebook/direct_message");
    expect(unresolved).not.toContain("Acting platform:");
  });

  it("refuses outright when the acting platform has no enabled surface", () => {
    const unsupported = composedFor({ platform: "threads", targetId: "tgt_th" });
    expect(unsupported).toContain("No enabled writing surface exists for the acting platform threads");
    expect(unsupported).toContain("propose nothing");
    expect(unsupported).not.toContain("x/reply");
  });

  it("names the recipient boundary explicitly", () => {
    expect(composed).toContain("Workspace Personality answers \"who is speaking\"");
    expect(composed).toContain(
      "never copy contact facts, persona attributes, relationship notes, or private CRM fields",
    );
    expect(composed).toContain("Only `sourceRefs` evidence may become a fact");
  });
});

describe("brief composition boundary", () => {
  it("attaches the shared contract to any opted-in workflow", () => {
    const brief = buildAgentWorkflowBrief({
      template,
      workflowRunId: "run_1",
      config: { ...buildContactNurtureTemplateConfig(), targetPlatform: "linkedin" },
      signalsBaseUrl: "http://127.0.0.1:3000",
    });
    expect(brief).toContain("Shared writing-intent contract");
    expect(brief).toContain("Contact Relationship Nurture execution contract");
    expect(brief).not.toContain("Signals Writing execution contract");
    expect(brief).toContain("linkedin/comment");
  });

  it("leaves a workflow without the opt-in untouched", () => {
    const brief = buildAgentWorkflowBrief({
      template,
      workflowRunId: "run_1",
      config: {},
      signalsBaseUrl: "http://127.0.0.1:3000",
    });
    expect(brief).not.toContain("Shared writing-intent contract");
    expect(brief).not.toContain("Signals Writing execution contract");
  });

  it("keeps the Platform-native lane on its own contract", () => {
    const brief = buildAgentWorkflowBrief({
      template: { ...template, name: "Platform-native writing", templateType: "content" },
      workflowRunId: "run_2",
      config: buildWritingTemplateConfig({
        launchId: "launch_1",
        surfaces: [{ platform: "x", surface: "x/post" }],
      }),
      signalsBaseUrl: "http://127.0.0.1:3000",
    });
    expect(brief).toContain("Signals Writing execution contract");
    expect(brief).not.toContain("Shared writing-intent contract");
  });
});
