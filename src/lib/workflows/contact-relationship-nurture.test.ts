import { describe, expect, it } from "vitest";
import {
  buildContactNurtureBriefSection,
  buildContactNurtureTemplateConfig,
  clampContactNurtureSlider,
  isContactNurtureTemplateConfig,
  readContactNurtureConfig,
} from "@/lib/workflows/contact-relationship-nurture";

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
});

describe("buildContactNurtureBriefSection", () => {
  it("generates contract instructions with goals, salted delay, and approval policy", () => {
    const brief = buildContactNurtureBriefSection({
      workflowRunId: "run-nurture-123",
      config: buildContactNurtureTemplateConfig({
        relationshipGoalFilter: "repost_amplification",
        maxActionsPerRun: 8,
        delayBetweenActionsSeconds: 35,
      }),
      signalsBaseUrl: "http://127.0.0.1:3000",
    });

    expect(brief).toContain("Contact Relationship Nurture execution contract");
    expect(brief).toContain("repost_amplification");
    expect(brief).toContain("35s");
    expect(brief).toContain("Approval gate is ON");
    expect(brief).toContain("MANDATORY WRITE-BACK TO SIGNALS");
    expect(brief).toContain("/api/content");
    expect(brief).toContain("log_interaction");
    expect(brief).toContain("run-nurture-123");
  });
});
