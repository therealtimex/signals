import { describe, expect, it } from "vitest";
import {
  NURTURE_TOUCHPOINT_PLAN,
  buildContactNurtureBriefSection,
  buildContactNurtureRunConfig,
  buildContactNurtureTemplateConfig,
  clampContactNurtureSlider,
  isContactNurtureTemplateConfig,
  readContactNurtureConfig,
  resolveNurtureSurface,
} from "@/lib/workflows/contact-relationship-nurture";
import { RELATIONSHIP_GOAL_ENUM } from "@/lib/relationship-goals";
import { getSurfaceCapabilities } from "@/lib/writing/capabilities";
import { readWritingIntentComposition } from "@/lib/workflows/writing-composition";

describe("clampContactNurtureSlider", () => {
  it("clamps maxTargets, maxActionsPerRun, and delayBetweenActionsSeconds", () => {
    expect(clampContactNurtureSlider("maxTargets", 0)).toBe(1);
    expect(clampContactNurtureSlider("maxTargets", 100)).toBe(50);
    expect(clampContactNurtureSlider("maxActionsPerRun", 0)).toBe(1);
    expect(clampContactNurtureSlider("maxActionsPerRun", 50)).toBe(20);
    expect(clampContactNurtureSlider("delayBetweenActionsSeconds", 10)).toBe(15);
    expect(clampContactNurtureSlider("delayBetweenActionsSeconds", 120)).toBe(60);
  });
});

describe("readContactNurtureConfig & buildContactNurtureTemplateConfig", () => {
  it("populates default values cleanly", () => {
    const config = readContactNurtureConfig({});
    expect(config.targetId).toBeNull();
    expect(config.relationshipGoalFilter).toBe("all");
    expect(config.maxTargets).toBe(10);
    expect(config.maxActionsPerRun).toBe(5);
    expect(config.delayBetweenActionsSeconds).toBe(30);
    expect(config.requireApproval).toBe(true);
    expect(config.autoAchieveOnMilestone).toBe(true);
  });

  it("identifies contact nurture template config marker", () => {
    const raw = buildContactNurtureTemplateConfig();
    expect(isContactNurtureTemplateConfig(raw)).toBe(true);
    expect(isContactNurtureTemplateConfig({})).toBe(false);
  });

  it("carries the assist-only writing-intent opt-in", () => {
    expect(readWritingIntentComposition(buildContactNurtureTemplateConfig())).toMatchObject({
      consumer: "contact_relationship_nurture",
      mandate: "assist_only",
      approvalPolicy: "explicit",
    });
  });
});

describe("nurture touchpoint plan", () => {
  it("maps every relationship goal onto a send-less surface", () => {
    for (const goal of RELATIONSHIP_GOAL_ENUM) {
      const plan = NURTURE_TOUCHPOINT_PLAN[goal];
      expect(plan).toBeDefined();
      for (const platform of ["x", "linkedin", "facebook"]) {
        const surface = resolveNurtureSurface(platform, plan.surfaceKind);
        expect(surface).not.toBeNull();
        expect(getSurfaceCapabilities(surface!).publish).toBe("draft_only");
      }
    }
  });

  it("resolves per-platform comment and direct-message surfaces", () => {
    expect(resolveNurtureSurface("x", "comment")).toBe("x/reply");
    expect(resolveNurtureSurface("linkedin", "comment")).toBe("linkedin/comment");
    expect(resolveNurtureSurface("facebook", "comment")).toBe("facebook/comment");
    expect(resolveNurtureSurface("x", "direct_message")).toBe("x/direct_message");
    expect(resolveNurtureSurface("threads", "comment")).toBeNull();
  });
});

describe("buildContactNurtureRunConfig", () => {
  it("constructs clamped runtime config payload with version marker", () => {
    const runConfig = buildContactNurtureRunConfig({
      targetId: "target-123",
      relationshipGoalFilter: "follow_back",
      maxTargets: 99,
      maxActionsPerRun: 0,
      delayBetweenActionsSeconds: 10,
      requireApproval: false,
      autoAchieveOnMilestone: true,
    });

    expect(runConfig).toMatchObject({
      contactNurture: { version: 1 },
      targetId: "target-123",
      relationshipGoalFilter: "follow_back",
      maxTargets: 50,
      maxActionsPerRun: 1,
      delayBetweenActionsSeconds: 15,
      requireApproval: false,
      autoAchieveOnMilestone: true,
    });
    expect(readWritingIntentComposition(runConfig)?.consumer).toBe(
      "contact_relationship_nurture",
    );
  });
});

describe("buildContactNurtureBriefSection", () => {
  it("emits writing intents instead of drafting prose from its own instructions", () => {
    const brief = buildContactNurtureBriefSection({
      workflowRunId: "run-nurture-123",
      config: buildContactNurtureTemplateConfig({
        relationshipGoalFilter: "repost_amplification",
        maxActionsPerRun: 8,
      }),
      signalsBaseUrl: "http://127.0.0.1:3000",
      platformTarget: { id: "tgt_x_1", platform: "x", name: "Acting", handle: "acting" },
    });

    expect(brief).toContain("Contact Relationship Nurture execution contract");
    expect(brief).toContain("repost_amplification");
    expect(brief).toContain("Mandate: assist_only");
    expect(brief).toContain("emit one writing intent per contact");
    expect(brief).toContain("Do not draft prose from these instructions");
    expect(brief).toContain("surface=x/reply");
    expect(brief).toContain("metadata.writing.intent");
    expect(brief).toContain("run-nurture-123");
  });

  it("keeps recipient context separate from the speaker identity", () => {
    const brief = buildContactNurtureBriefSection({
      workflowRunId: "run-nurture-123",
      config: buildContactNurtureTemplateConfig(),
      signalsBaseUrl: "http://127.0.0.1:3000",
    });

    expect(brief).toContain("who is receiving and what is relevant");
    expect(brief).toContain("Personality is the speaker; the contact is the recipient");
    expect(brief).toContain("IDENTITY.md, SOUL.md, VOICE.md, or BRAND.md");
  });

  it("requires explicit approval even when the run control turns the gate off", () => {
    const brief = buildContactNurtureBriefSection({
      workflowRunId: "run-nurture-123",
      config: buildContactNurtureTemplateConfig({ requireApproval: false }),
      signalsBaseUrl: "http://127.0.0.1:3000",
    });

    expect(brief).toContain("explicit user approval is still required");
    expect(brief).toContain("assist-only mandate outranks this run control");
    expect(brief).not.toContain("Execute touchpoints directly");
  });

  it("never instructs publishing, sending, or submission verification", () => {
    for (const requireApproval of [true, false]) {
      const brief = buildContactNurtureBriefSection({
        workflowRunId: "run-nurture-123",
        config: buildContactNurtureTemplateConfig({ requireApproval }),
        signalsBaseUrl: "http://127.0.0.1:3000",
      });

      expect(brief).not.toMatch(/Submission & Verification|native submit button|DOM snapshot/);
      expect(brief).not.toContain('"status": "published"');
      expect(brief).not.toMatch(/before publishing|then follow\b|send connection request/);
      expect(brief).toContain("It never publishes, comments, replies, sends a message");
    }
  });

  it("does not claim X when no acting target is configured", () => {
    const brief = buildContactNurtureBriefSection({
      workflowRunId: "run-nurture-123",
      config: buildContactNurtureTemplateConfig(),
      signalsBaseUrl: "http://127.0.0.1:3000",
    });

    expect(brief).toContain("Active Platform: unresolved — detect per contact");
    expect(brief).toContain("resolve the acting profile for this contact's platform");
    expect(brief).not.toContain("surface=x/reply");
  });

  it("uses the resolved target row over a stale config platform", () => {
    const brief = buildContactNurtureBriefSection({
      workflowRunId: "run-nurture-123",
      config: { ...buildContactNurtureTemplateConfig(), targetPlatform: "x" },
      signalsBaseUrl: "http://127.0.0.1:3000",
      platformTarget: {
        id: "tgt_fb_1",
        platform: "facebook",
        name: "Page",
        handle: "page",
      },
    });

    expect(brief).toContain("Active Platform: facebook");
    expect(brief).toContain("surface=facebook/comment");
    expect(brief).not.toContain("surface=x/reply");
  });

  it("customizes surfaces and interaction type for a LinkedIn acting target", () => {
    const brief = buildContactNurtureBriefSection({
      workflowRunId: "run-linkedin-456",
      config: buildContactNurtureTemplateConfig({
        targetId: "tgt_linkedin_1",
        relationshipGoalFilter: "warm_conversation",
      }),
      signalsBaseUrl: "http://localhost:3010",
      platformTarget: {
        id: "tgt_linkedin_1",
        platform: "linkedin",
        name: "Trung Le",
        handle: "ledangtrung",
      },
    });

    expect(brief).toContain("LinkedIn: Trung Le (ledangtrung) [ID: tgt_linkedin_1]");
    expect(brief).toContain("Active Platform: linkedin");
    expect(brief).toContain("surface=linkedin/direct_message");
    expect(brief).toContain('"interactionType": "linkedin_comment"');
    expect(brief).toContain("Observe only");
  });
});
