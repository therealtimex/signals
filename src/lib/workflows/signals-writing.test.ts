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
