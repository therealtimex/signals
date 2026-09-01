import { describe, expect, it } from "vitest";
import {
  buildWritingBriefSection,
  buildWritingTemplateConfig,
  isSignalsWritingTemplateConfig,
  readSignalsWritingTemplateConfig,
} from "@/lib/workflows/signals-writing";
import { buildAgentWorkflowBrief } from "@/lib/workflows/template-brief";

const config = buildWritingTemplateConfig({
  launchId: "launch_1",
  goal: "leads",
  surfaces: [
    { platform: "x", surface: "x/thread", targetId: "tgt_x" },
    { platform: "youtube", surface: "youtube/thumbnail_brief" },
  ],
  sourceContentItemIds: ["content_1"],
  instructions: "Use the launch notes.",
});

describe("Signals Writing workflow contract", () => {
  it("validates the bounded nested config", () => {
    expect(isSignalsWritingTemplateConfig(config)).toBe(true);
    expect(readSignalsWritingTemplateConfig(config)?.launchId).toBe("launch_1");
    expect(
      isSignalsWritingTemplateConfig(
        buildWritingTemplateConfig({
          surfaces: [{ platform: "linkedin", surface: "x/post" }],
        }),
      ),
    ).toBe(false);
  });

  it("renders every capability row and contains no retired tool name", () => {
    const section = buildWritingBriefSection({
      template: { id: "template_1", name: "Platform-native writing" },
      config,
      workflowRunId: "run_1",
      signalsBaseUrl: "http://127.0.0.1:3000",
    });
    expect(section).toContain("x/thread");
    expect(section).toContain("publish=direct");
    expect(section).toContain("youtube/thumbnail_brief");
    expect(section).toContain("publish=export_only");
    expect(section).toContain("get_writing_context");
    expect(section).toContain("IDENTITY.md, SOUL.md, VOICE.md, BRAND.md");
    expect(section).toContain("get_writing_context.personality as the binding gate");
    expect(section).toContain("submits only its active bindingId");
    expect(section).toContain("Do not edit workspace Personality files");
    expect(section).toContain("query_graph");
    expect(section).toContain("new derived alternatives omit id");
    expect(section).toContain(".claude/skills/signals-writing/SKILL.md");
    expect(section).toContain("scripts/writing-cli.cjs");
    expect(section).toContain("upsert_variant");
    expect(section).toContain("materialize_variant");
    expect(section).toContain("list_voice_profiles");
    expect(section).toContain("get_voice_profile");
    expect(section).toContain("upsert_voice_profile");
    expect(section).toContain("approve_voice_profile");
    expect(section).toContain("revoke_variant_approval");
    expect(section).not.toContain("create_content_draft");
    expect(section).not.toMatch(/save_draft|report_progress|search_web/);
  });

  it("selects the Personality lane before audit, approval, or materialization", () => {
    const section = buildWritingBriefSection({
      template: { id: "template_1", name: "Platform-native writing" },
      config,
      workflowRunId: "run_1",
      signalsBaseUrl: "http://127.0.0.1:3000",
    });

    expect(section).toContain("Persist by the lane returned in `get_writing_context.personality.status`");
    expect(section).toContain("For `bound`/`source_stale`");
    expect(section).toContain("run `measure`, create the structured audit");
    expect(section).toContain("run `verdict` then `precheck`");
    expect(section).toContain("only the current `bindingId`");
    expect(section).toContain("For `unbound`, create only a targetless, unaudited sketch");
    expect(section).toContain(
      "omit `metadata.writing.targetId` and `metadata.writing.personality`",
    );
    expect(section).toContain("send `metadata.writing.audit: null`");
    expect(section).toContain("top-level `label` suffix to `legacy_unbound sketch`");
    expect(section).toContain(
      "confirm the selected `variants[].personalityState` is `legacy_unbound`",
    );
    expect(section).toContain(
      "Stop before audit, verdict, precheck, approval, materialization, export, or publish",
    );
    expect(section).toContain("In the `bound`/`source_stale` full lane only");
    expect(section).toContain("render the persisted approval card after audit and precheck");
    expect(section).toContain("wait for explicit user approval, then call `materialize_variant`");
    expect(section).not.toContain("Draft and audit one platform-native artifact per surface");
    expect(section).not.toContain("Call materialize_variant only after");
  });

  it("appears only in briefs carrying the signalsWriting config", () => {
    const template = {
      id: "template_1",
      name: "Platform-native writing",
      description: "Write",
      templateType: "content" as const,
      platform: null,
      systemPrompt: "Follow the contract.",
      targetPersona: null,
    };
    const writingBrief = buildAgentWorkflowBrief({
      template,
      workflowRunId: "run_1",
      config,
      signalsBaseUrl: "http://127.0.0.1:3000",
    });
    const ordinaryBrief = buildAgentWorkflowBrief({
      template,
      workflowRunId: "run_2",
      config: {},
      signalsBaseUrl: "http://127.0.0.1:3000",
    });
    expect(writingBrief).toContain("Signals Writing execution contract");
    expect(ordinaryBrief).not.toContain("Signals Writing execution contract");
  });
});
