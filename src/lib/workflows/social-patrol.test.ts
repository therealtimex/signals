import { describe, expect, it } from "vitest";
import {
  DEFAULT_INTENT_KEYWORDS,
  MAX_LEASE_TTL_SECONDS,
  buildSocialPatrolBriefSection,
  buildSocialPatrolRunConfig,
  buildSocialPatrolTemplateConfig,
  clampSocialPatrolSlider,
  isSocialPatrolTemplateConfig,
  readSocialPatrolConfig,
  socialPatrolLeaseTtlSeconds,
  stripRetiredSocialPatrolConfigKeys,
} from "@/lib/workflows/social-patrol";

describe("clampSocialPatrolSlider", () => {
  it("snaps to the step grid and clamps into range 1..100", () => {
    expect(clampSocialPatrolSlider("maxComments", 0)).toBe(1);
    expect(clampSocialPatrolSlider("maxComments", 150)).toBe(100);
    expect(clampSocialPatrolSlider("maxComments", 42)).toBe(42);
    expect(clampSocialPatrolSlider("maxScrapedContacts", 0)).toBe(1);
    expect(clampSocialPatrolSlider("maxScrapedContacts", 150)).toBe(100);
    expect(clampSocialPatrolSlider("maxScrapedContacts", 73)).toBe(73);
  });

  it("falls back to the default for non-numeric values", () => {
    expect(clampSocialPatrolSlider("maxComments", "not a number")).toBe(5);
    expect(clampSocialPatrolSlider("maxComments", null)).toBe(5);
    expect(clampSocialPatrolSlider("maxScrapedContacts", undefined)).toBe(20);
  });

  it("accepts numeric strings from range inputs", () => {
    expect(clampSocialPatrolSlider("maxComments", "30")).toBe(30);
    expect(clampSocialPatrolSlider("maxScrapedContacts", "80")).toBe(80);
  });
});

describe("socialPatrolLeaseTtlSeconds", () => {
  it("returns the standard maximum lease TTL", () => {
    expect(socialPatrolLeaseTtlSeconds()).toBe(MAX_LEASE_TTL_SECONDS);
  });
});

describe("readSocialPatrolConfig", () => {
  it("fills slider defaults for an empty config", () => {
    expect(readSocialPatrolConfig({})).toEqual({
      targetId: null,
      maxComments: 5,
      maxScrapedContacts: 20,
      communities: [],
      intentKeywords: [],
      requireApproval: true,
    });
  });

  it("preserves a cleared keyword list instead of restoring the defaults", () => {
    expect(readSocialPatrolConfig({ intentKeywords: [] }).intentKeywords).toEqual([]);
    expect(
      readSocialPatrolConfig(buildSocialPatrolTemplateConfig()).intentKeywords,
    ).toEqual(DEFAULT_INTENT_KEYWORDS);
  });

  it("reads stored values and clamps out-of-range ones", () => {
    expect(
      readSocialPatrolConfig({
        targetId: " tgt_1 ",
        maxComments: 50,
        maxScrapedContacts: 100,
        communities: ["Codex VN"],
        intentKeywords: ["lỗi"],
        requireApproval: false,
      }),
    ).toEqual({
      targetId: "tgt_1",
      maxComments: 50,
      maxScrapedContacts: 100,
      communities: ["Codex VN"],
      intentKeywords: ["lỗi"],
      requireApproval: false,
    });
  });

  it("keeps approval on unless it was explicitly disabled", () => {
    expect(readSocialPatrolConfig({ requireApproval: undefined }).requireApproval).toBe(true);
    expect(readSocialPatrolConfig({ requireApproval: false }).requireApproval).toBe(false);
  });

  it("treats a blank target as unset", () => {
    expect(readSocialPatrolConfig({ targetId: "   " }).targetId).toBeNull();
  });
});

describe("buildSocialPatrolTemplateConfig", () => {
  it("is detected as a patrol template and ships the documented defaults", () => {
    const config = buildSocialPatrolTemplateConfig();
    expect(isSocialPatrolTemplateConfig(config)).toBe(true);
    expect(isSocialPatrolTemplateConfig({ maxEngagements: 5 })).toBe(false);
    expect(readSocialPatrolConfig(config)).toEqual({
      targetId: null,
      maxComments: 5,
      maxScrapedContacts: 20,
      communities: [],
      intentKeywords: DEFAULT_INTENT_KEYWORDS,
      requireApproval: true,
    });
  });

  it("round-trips through the run config unchanged", () => {
    const stored = buildSocialPatrolTemplateConfig();
    const draft = readSocialPatrolConfig(stored);
    expect(readSocialPatrolConfig(buildSocialPatrolRunConfig(draft))).toEqual(draft);
  });

  it("no longer carries durationMinutes or maxPosts", () => {
    expect(buildSocialPatrolTemplateConfig()).not.toHaveProperty("durationMinutes");
    expect(buildSocialPatrolTemplateConfig()).not.toHaveProperty("maxPosts");
    const runKeys = Object.keys(buildSocialPatrolRunConfig(readSocialPatrolConfig({})));
    expect(runKeys).not.toContain("durationMinutes");
    expect(runKeys).not.toContain("maxPosts");
  });
});

describe("stripRetiredSocialPatrolConfigKeys", () => {
  it("drops stale maxPosts and durationMinutes left by older seeds", () => {
    expect(
      stripRetiredSocialPatrolConfigKeys({
        socialPatrol: { version: 1 },
        maxPosts: 2,
        durationMinutes: 15,
        maxComments: 3,
      }),
    ).toEqual({ socialPatrol: { version: 1 }, maxComments: 3 });
  });

  it("returns null when there is nothing to strip", () => {
    expect(stripRetiredSocialPatrolConfigKeys(buildSocialPatrolTemplateConfig())).toBeNull();
  });
});

describe("buildSocialPatrolRunConfig", () => {
  it("emits the run payload with standard lease TTL", () => {
    expect(
      buildSocialPatrolRunConfig({
        targetId: "tgt_fb",
        maxComments: 10,
        maxScrapedContacts: 50,
        communities: ["Codex VN", "codex vn"],
        intentKeywords: ["recommend"],
        requireApproval: true,
      }),
    ).toEqual({
      targetId: "tgt_fb",
      leaseTtlSeconds: MAX_LEASE_TTL_SECONDS,
      maxComments: 10,
      maxScrapedContacts: 50,
      communities: ["Codex VN"],
      intentKeywords: ["recommend"],
      requireApproval: true,
    });
  });

  it("re-clamps a stale draft rather than trusting the dialog state", () => {
    const config = buildSocialPatrolRunConfig({
      targetId: null,
      maxComments: -4,
      maxScrapedContacts: 500,
      communities: [],
      intentKeywords: [],
      requireApproval: false,
    });

    expect(config).toMatchObject({
      targetId: null,
      maxComments: 1,
      maxScrapedContacts: 100,
      requireApproval: false,
    });
  });
});

describe("buildSocialPatrolBriefSection", () => {
  const config = {
    socialPatrol: { version: 1 },
    targetId: "tgt_fb",
    maxComments: 8,
    maxScrapedContacts: 30,
    communities: ["Codex VN"],
    intentKeywords: ["recommend", "lỗi"],
    requireApproval: true,
  };

  it("spells out lease, browser, budget, write-back, and release steps", () => {
    const section = buildSocialPatrolBriefSection({ workflowRunId: "run_9", config });

    expect(section).toContain(
      `signals-pp-cli targets prepare tgt_fb --intent browse --ttl ${MAX_LEASE_TTL_SECONDS}`,
    );
    expect(section).toContain("`sessionName` field of that prepare response");
    expect(section).toContain("expectedHandle");
    expect(section).toContain("Codex VN");
    expect(section).toContain("recommend, lỗi");
    expect(section).toContain("8 high-intent comment(s)");
    expect(section).toContain("30 contact(s)");
    expect(section).toContain(
      "signals-pp-cli import contacts --file workflow-runs/run_9/contacts.csv --dedupe",
    );
    expect(section).toContain("signals-pp-cli targets release --lease <leaseId>");
  });

  it("forbids posting to the acting profile's own timeline", () => {
    const section = buildSocialPatrolBriefSection({ workflowRunId: "run_9", config });
    expect(section).toContain("This shift is outbound only");
    expect(section).toContain("Profile Publishing & Repost");
    expect(section).not.toContain("personal profile post");
    expect(section).not.toContain("maxPosts");
    expect(section).not.toContain("durationMinutes");
  });

  it("calls out the approval checkpoint", () => {
    const section = buildSocialPatrolBriefSection({ workflowRunId: "run_9", config });
    expect(section).toContain("Approval checkpoint is ON");
  });

  it("switches the approval line when confirmation is disabled", () => {
    const section = buildSocialPatrolBriefSection({
      workflowRunId: "run_9",
      config: { ...config, requireApproval: false },
    });
    expect(section).toContain("Approval checkpoint is OFF");
  });

  it("names the fallback scope when no communities are configured", () => {
    const section = buildSocialPatrolBriefSection({
      workflowRunId: "run_9",
      config: { ...config, communities: [] },
    });
    expect(section).toContain("no communities configured");
  });

  it("does not reinstate default keywords the run config no longer lists", () => {
    const section = buildSocialPatrolBriefSection({
      workflowRunId: "run_9",
      config: { ...config, intentKeywords: [] },
    });
    expect(section).toContain("no keyword filter configured");
    for (const keyword of DEFAULT_INTENT_KEYWORDS) {
      expect(section).not.toContain(`(${keyword}`);
    }
  });
});
