import { describe, expect, it } from "vitest";
import {
  DEFAULT_PROFILE_PUBLISH_TONE,
  MAX_INSTRUCTIONS_LENGTH,
  MAX_PUBLISH_TARGETS,
  PROFILE_PUBLISH_TONES,
  buildProfilePublishBriefSection,
  buildProfilePublishRunConfig,
  buildProfilePublishTemplateConfig,
  clampProfilePublishSlider,
  isProfilePublishTemplateConfig,
  profilePublishToneLabel,
  readProfilePublishConfig,
  readProfilePublishTone,
} from "@/lib/workflows/profile-publish";
import { isSocialPatrolTemplateConfig } from "@/lib/workflows/social-patrol";

describe("clampProfilePublishSlider", () => {
  it("clamps each budget into its documented range", () => {
    expect(clampProfilePublishSlider("maxOriginalPosts", 9)).toBe(3);
    expect(clampProfilePublishSlider("maxOriginalPosts", -1)).toBe(0);
    expect(clampProfilePublishSlider("maxReposts", 12)).toBe(5);
  });

  it("keeps a deliberate zero but falls back for unusable values", () => {
    expect(clampProfilePublishSlider("maxOriginalPosts", 0)).toBe(0);
    expect(clampProfilePublishSlider("maxReposts", 0)).toBe(0);
    expect(clampProfilePublishSlider("maxOriginalPosts", undefined)).toBe(1);
    expect(clampProfilePublishSlider("maxReposts", "not a number")).toBe(1);
  });
});

describe("readProfilePublishTone", () => {
  it("accepts the four documented tones", () => {
    expect(PROFILE_PUBLISH_TONES.map((tone) => tone.value)).toEqual([
      "technical",
      "founder",
      "punchy_tips",
      "story",
    ]);
    for (const tone of PROFILE_PUBLISH_TONES) {
      expect(readProfilePublishTone(tone.value)).toBe(tone.value);
    }
  });

  it("falls back to the default for anything else", () => {
    expect(readProfilePublishTone("shouty")).toBe(DEFAULT_PROFILE_PUBLISH_TONE);
    expect(readProfilePublishTone(undefined)).toBe(DEFAULT_PROFILE_PUBLISH_TONE);
  });

  it("labels the tone for the picker", () => {
    expect(profilePublishToneLabel("punchy_tips")).toBe("Punchy Tips");
    expect(profilePublishToneLabel("story")).toBe("Casual");
  });
});

describe("readProfilePublishConfig", () => {
  it("fills defaults for an empty config", () => {
    expect(readProfilePublishConfig({})).toEqual({
      targetIds: [],
      instructions: "",
      maxOriginalPosts: 1,
      maxReposts: 1,
      topics: [],
      tone: "technical",
      requireApproval: true,
    });
  });

  it("normalizes the cross-post selection without folding id case", () => {
    expect(
      readProfilePublishConfig({ targetIds: [" tgt_x ", "tgt_x", "tgt_X", "", 7] }).targetIds,
    ).toEqual(["tgt_x", "tgt_X"]);
  });

  it("caps the cross-post fan-out", () => {
    const many = Array.from({ length: MAX_PUBLISH_TARGETS + 4 }, (_, i) => `tgt_${i}`);
    expect(readProfilePublishConfig({ targetIds: many }).targetIds).toHaveLength(
      MAX_PUBLISH_TARGETS,
    );
  });

  it("trims a blank source folder away instead of shipping an empty path", () => {
    expect(readProfilePublishConfig({ sourceFolderPath: "   " })).not.toHaveProperty(
      "sourceFolderPath",
    );
    expect(
      readProfilePublishConfig({ sourceFolderPath: " ~/notes " }).sourceFolderPath,
    ).toBe("~/notes");
  });

  it("caps a runaway instruction blob", () => {
    const long = "x".repeat(MAX_INSTRUCTIONS_LENGTH + 500);
    expect(readProfilePublishConfig({ instructions: long }).instructions).toHaveLength(
      MAX_INSTRUCTIONS_LENGTH,
    );
  });

  it("keeps the approval gate on unless it was explicitly disabled", () => {
    expect(readProfilePublishConfig({}).requireApproval).toBe(true);
    expect(readProfilePublishConfig({ requireApproval: false }).requireApproval).toBe(false);
  });
});

describe("buildProfilePublishTemplateConfig", () => {
  it("is detected as a publishing template and not as a patrol one", () => {
    const config = buildProfilePublishTemplateConfig();
    expect(isProfilePublishTemplateConfig(config)).toBe(true);
    // Both templates flow through the same activate dialog and brief builder, so the two
    // marker keys must never both match one config.
    expect(isSocialPatrolTemplateConfig(config)).toBe(false);
    expect(isProfilePublishTemplateConfig({ topics: ["ai"] })).toBe(false);
  });

  it("ships the documented defaults", () => {
    expect(readProfilePublishConfig(buildProfilePublishTemplateConfig())).toEqual({
      targetIds: [],
      instructions: "",
      maxOriginalPosts: 1,
      maxReposts: 1,
      topics: [],
      tone: "technical",
      requireApproval: true,
    });
  });

  it("round-trips through the run config unchanged", () => {
    const draft = readProfilePublishConfig(buildProfilePublishTemplateConfig());
    expect(readProfilePublishConfig(buildProfilePublishRunConfig(draft))).toEqual(draft);
  });
});

describe("buildProfilePublishRunConfig", () => {
  it("re-clamps a stale draft rather than trusting the dialog state", () => {
    expect(
      buildProfilePublishRunConfig({
        targetIds: ["tgt_x", "tgt_x", " tgt_li "],
        instructions: "  Ship notes for v0.3  ",
        sourceFolderPath: "  ~/vault  ",
        maxOriginalPosts: 99,
        maxReposts: -3,
        topics: ["ai-agents", "AI-Agents", "crm"],
        tone: "technical",
        requireApproval: true,
      }),
    ).toEqual({
      targetIds: ["tgt_x", "tgt_li"],
      instructions: "Ship notes for v0.3",
      sourceFolderPath: "~/vault",
      maxOriginalPosts: 3,
      maxReposts: 0,
      topics: ["ai-agents", "crm"],
      tone: "technical",
      requireApproval: true,
    });
  });

  it("emits a null source folder when none was configured", () => {
    const config = buildProfilePublishRunConfig(readProfilePublishConfig({}));
    expect(config.sourceFolderPath).toBeNull();
  });
});

describe("buildProfilePublishBriefSection", () => {
  const config = {
    profilePublish: { version: 1 },
    targetIds: ["tgt_x", "tgt_fb"],
    instructions: "v0.3 ships offline embeddings",
    sourceFolderPath: "~/content-vault/launch-notes",
    maxOriginalPosts: 2,
    maxReposts: 1,
    topics: ["ai-agents", "local-first"],
    tone: "punchy_tips",
    requireApproval: true,
  };

  const brief = (overrides: Record<string, unknown> = {}) =>
    buildProfilePublishBriefSection({
      workflowRunId: "run_7",
      config: { ...config, ...overrides },
      signalsBaseUrl: "http://127.0.0.1:3000",
    });

  it("names every selected profile, the source material, and the budget", () => {
    const section = brief();
    expect(section).toContain("tgt_x, tgt_fb");
    expect(section).toContain("v0.3 ships offline embeddings");
    expect(section).toContain("~/content-vault/launch-notes");
    expect(section).toContain("2 original timeline post(s)");
    expect(section).toContain("1 curated quote-post/repost(s)");
    expect(section).toContain("ai-agents, local-first");
    expect(section).toContain("Punchy Tips");
  });

  it("names the media upload hop that turns a local asset into a mediaAssetId", () => {
    const section = brief();
    // A publish job carries ids, not paths, and no agent-tool uploads a file — without this
    // step the agent has nowhere to get an id and the post ships with no image.
    expect(section).toContain("http://127.0.0.1:3000/api/media");
    expect(section).toContain("multipart/form-data");
    expect(section).toContain("context=compose");
    expect(section).toContain("platformTarget accepts x, linkedin, or facebook");
    expect(section).toContain("kind: \"repost\"");
    expect(section).not.toContain("Facebook has no upload lane here");
  });

  it("spells out both publishing lanes with the resolved Signals base URL", () => {
    const section = brief();
    expect(section).toContain("http://127.0.0.1:3000/api/content/send-to-agent");
    expect(section).toContain("signals-publish lane");
    expect(section).toContain("kind: \"quote\"");
    expect(section).not.toContain("Drive them yourself");
    expect(section).toContain("run_7");
  });

  it("keeps the run off the patrol lane", () => {
    expect(brief()).toContain("Social Intent Patrol");
    expect(brief()).toContain("Do not patrol communities");
  });

  it("switches the approval line when the gate is disabled", () => {
    expect(brief()).toContain("Approval gate is ON");
    expect(brief({ requireApproval: false })).toContain("Approval gate is OFF");
  });

  it("calls out curation-only and originals-only runs", () => {
    expect(brief({ maxOriginalPosts: 0 })).toContain("this is a curation-only run");
    expect(brief({ maxReposts: 0 })).toContain("original posts only");
    expect(brief()).not.toContain("curation-only run");
  });

  it("says what to do when instructions, folder, or topics are missing", () => {
    const section = brief({ instructions: "", sourceFolderPath: null, topics: [] });
    expect(section).toContain("No operator instructions were provided");
    expect(section).toContain("No source folder configured");
    expect(section).toContain("No focus topics configured");
  });

  it("stops the agent instead of guessing when no profile is selected", () => {
    expect(brief({ targetIds: [] })).toContain("no acting profile selected");
  });
});
