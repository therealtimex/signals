import { describe, expect, it } from "vitest";
import {
  DEFAULT_INTENT_KEYWORDS,
  MAX_LEASE_TTL_SECONDS,
  MAX_TAG_COUNT,
  buildSocialPatrolBriefSection,
  buildSocialPatrolRunConfig,
  buildSocialPatrolTemplateConfig,
  clampSocialPatrolSlider,
  isSocialPatrolTemplateConfig,
  normalizeTagList,
  readSocialPatrolConfig,
  socialPatrolLeaseTtlSeconds,
  stripRetiredSocialPatrolConfigKeys,
} from "@/lib/workflows/social-patrol";

describe("clampSocialPatrolSlider", () => {
  it("snaps to the step grid and clamps into range", () => {
    expect(clampSocialPatrolSlider("durationMinutes", 17)).toBe(15);
    expect(clampSocialPatrolSlider("durationMinutes", 3)).toBe(5);
    expect(clampSocialPatrolSlider("durationMinutes", 999)).toBe(60);
    expect(clampSocialPatrolSlider("maxScrapedContacts", 23)).toBe(25);
    expect(clampSocialPatrolSlider("maxScrapedContacts", 1)).toBe(5);
  });

  it("keeps zero for the scan-only comment budget instead of falling back", () => {
    expect(clampSocialPatrolSlider("maxComments", 0)).toBe(0);
  });

  it("falls back to the default for non-numeric values", () => {
    expect(clampSocialPatrolSlider("maxComments", "not a number")).toBe(2);
    expect(clampSocialPatrolSlider("durationMinutes", null)).toBe(15);
    expect(clampSocialPatrolSlider("maxScrapedContacts", undefined)).toBe(20);
  });

  it("accepts numeric strings from range inputs", () => {
    expect(clampSocialPatrolSlider("durationMinutes", "30")).toBe(30);
  });
});

describe("normalizeTagList", () => {
  it("trims, drops blanks, and de-duplicates case-insensitively", () => {
    expect(normalizeTagList([" Codex VN ", "codex vn", "", "  ", "Vibe Code"])).toEqual([
      "Codex VN",
      "Vibe Code",
    ]);
  });

  it("splits comma-separated strings", () => {
    expect(normalizeTagList("recommend, alternative ,token")).toEqual([
      "recommend",
      "alternative",
      "token",
    ]);
  });

  it("caps the list length", () => {
    const many = Array.from({ length: MAX_TAG_COUNT + 5 }, (_, i) => `tag${i}`);
    expect(normalizeTagList(many)).toHaveLength(MAX_TAG_COUNT);
  });

  it("returns an empty list for unusable input", () => {
    expect(normalizeTagList(undefined)).toEqual([]);
    expect(normalizeTagList([1, null, {}])).toEqual([]);
  });
});

describe("socialPatrolLeaseTtlSeconds", () => {
  it("matches the shift length while it fits the lease ceiling", () => {
    expect(socialPatrolLeaseTtlSeconds(15)).toBe(900);
    expect(socialPatrolLeaseTtlSeconds(30)).toBe(1800);
  });

  it("caps longer shifts at the prepare_platform_target maximum", () => {
    expect(socialPatrolLeaseTtlSeconds(60)).toBe(MAX_LEASE_TTL_SECONDS);
  });
});

describe("readSocialPatrolConfig", () => {
  it("fills slider defaults for an empty config", () => {
    expect(readSocialPatrolConfig({})).toEqual({
      targetId: null,
      durationMinutes: 15,
      maxComments: 2,
      maxScrapedContacts: 20,
      communities: [],
      intentKeywords: [],
      requireApproval: true,
    });
  });

  it("preserves a cleared keyword list instead of restoring the defaults", () => {
    // The seeded template carries the defaults explicitly, so empty means the operator
    // removed every pill — the brief must not contradict the config block it ships with.
    expect(readSocialPatrolConfig({ intentKeywords: [] }).intentKeywords).toEqual([]);
    expect(
      readSocialPatrolConfig(buildSocialPatrolTemplateConfig()).intentKeywords,
    ).toEqual(DEFAULT_INTENT_KEYWORDS);
  });

  it("reads stored values and clamps out-of-range ones", () => {
    expect(
      readSocialPatrolConfig({
        targetId: " tgt_1 ",
        durationMinutes: 45,
        maxComments: 0,
        maxScrapedContacts: 50,
        communities: ["Codex VN"],
        intentKeywords: ["lỗi"],
        requireApproval: false,
      }),
    ).toEqual({
      targetId: "tgt_1",
      durationMinutes: 45,
      maxComments: 0,
      maxScrapedContacts: 50,
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
      durationMinutes: 15,
      maxComments: 2,
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

  it("no longer carries a personal-profile post budget", () => {
    expect(buildSocialPatrolTemplateConfig()).not.toHaveProperty("maxPosts");
    expect(Object.keys(buildSocialPatrolRunConfig(readSocialPatrolConfig({})))).not.toContain(
      "maxPosts",
    );
  });
});

describe("stripRetiredSocialPatrolConfigKeys", () => {
  it("drops a stale maxPosts left by an older seed", () => {
    expect(
      stripRetiredSocialPatrolConfigKeys({ socialPatrol: { version: 1 }, maxPosts: 2, maxComments: 3 }),
    ).toEqual({ socialPatrol: { version: 1 }, maxComments: 3 });
  });

  it("returns null when there is nothing to strip", () => {
    expect(stripRetiredSocialPatrolConfigKeys(buildSocialPatrolTemplateConfig())).toBeNull();
  });
});

describe("buildSocialPatrolRunConfig", () => {
  it("emits the run payload with a derived lease TTL", () => {
    expect(
      buildSocialPatrolRunConfig({
        targetId: "tgt_fb",
        durationMinutes: 60,
        maxComments: 5,
        maxScrapedContacts: 50,
        communities: ["Codex VN", "codex vn"],
        intentKeywords: ["recommend"],
        requireApproval: true,
      }),
    ).toEqual({
      targetId: "tgt_fb",
      durationMinutes: 60,
      leaseTtlSeconds: MAX_LEASE_TTL_SECONDS,
      maxComments: 5,
      maxScrapedContacts: 50,
      communities: ["Codex VN"],
      intentKeywords: ["recommend"],
      requireApproval: true,
    });
  });

  it("re-clamps a stale draft rather than trusting the dialog state", () => {
    const config = buildSocialPatrolRunConfig({
      targetId: null,
      durationMinutes: 500,
      maxComments: -4,
      maxScrapedContacts: 3,
      communities: [],
      intentKeywords: [],
      requireApproval: false,
    });

    expect(config).toMatchObject({
      targetId: null,
      durationMinutes: 60,
      maxComments: 0,
      maxScrapedContacts: 5,
      requireApproval: false,
    });
  });
});

describe("buildSocialPatrolBriefSection", () => {
  const config = {
    socialPatrol: { version: 1 },
    targetId: "tgt_fb",
    durationMinutes: 60,
    maxComments: 3,
    maxScrapedContacts: 25,
    communities: ["Codex VN"],
    intentKeywords: ["recommend", "lỗi"],
    requireApproval: true,
  };

  it("spells out lease, browser, budget, write-back, and release steps", () => {
    const section = buildSocialPatrolBriefSection({ workflowRunId: "run_9", config });

    expect(section).toContain(
      `signals-pp-cli targets prepare tgt_fb --intent browse --ttl ${MAX_LEASE_TTL_SECONDS}`,
    );
    // The session must come from the prepare response — a target on a dedicated connection
    // returns its own session, so a hardcoded name would act as the wrong identity.
    expect(section).toContain("`sessionName` field of that prepare response");
    expect(section).toContain("expectedHandle");
    expect(section).toContain("Codex VN");
    expect(section).toContain("recommend, lỗi");
    expect(section).toContain("3 high-intent comment(s)");
    expect(section).toContain("25 contact(s)");
    expect(section).toContain(
      "signals-pp-cli import contacts --file workflow-runs/run_9/contacts.csv --dedupe",
    );
    expect(section).toContain("signals-pp-cli targets release --lease <leaseId>");
  });

  it("forbids posting to the acting profile's own timeline", () => {
    const section = buildSocialPatrolBriefSection({ workflowRunId: "run_9", config });
    expect(section).toContain("This shift is outbound only");
    expect(section).toContain("Profile Publishing & Repost");
    // The retired personal-post budget must not resurface as an instruction.
    expect(section).not.toContain("personal profile post");
    expect(section).not.toContain("maxPosts");
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

  it("calls out scan-only mode when the comment budget is zero", () => {
    expect(
      buildSocialPatrolBriefSection({
        workflowRunId: "run_9",
        config: { ...config, maxComments: 0 },
      }),
    ).toContain("scan-and-ingest-only shift");
    expect(
      buildSocialPatrolBriefSection({ workflowRunId: "run_9", config }),
    ).not.toContain("scan-and-ingest-only shift");
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
