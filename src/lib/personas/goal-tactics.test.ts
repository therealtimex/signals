import { describe, expect, it } from "vitest";
import { generateGoalTactic } from "@/lib/personas/goal-tactics";

describe("generateGoalTactic", () => {
  const mockContact = {
    id: "c1",
    name: "Özkan Taşlı",
    firstName: "Özkan",
    company: "outbids.lol",
    title: "Creator / Founder",
    platform: "x",
    platformHandle: "naxisty",
    relationshipGoal: "repost_amplification",
    relationshipGoalStatus: "not_started",
  };

  const mockPersona = {
    archetype: "Creator at Startup",
    tone: "Professional yet casual",
    summary: "Özkan is building outbids.lol",
    interests: ["Content creation", "Creator economy", "outbids.lol"],
    conversionTriggers: ["Expansion of content reach", "Brand collaborations"],
    engagementFormats: ["Short-form video", "Social media posts"],
  };

  it("returns null when goal is missing or invalid", () => {
    expect(generateGoalTactic({ id: "c1", name: "Test" }, mockPersona, null)).toBeNull();
    // @ts-expect-error test invalid goal
    expect(generateGoalTactic({ id: "c1", name: "Test" }, mockPersona, "unknown_goal")).toBeNull();
  });

  it("generates repost_amplification tactic with persona grounding", () => {
    const tactic = generateGoalTactic(mockContact, mockPersona);
    expect(tactic).not.toBeNull();
    expect(tactic?.goal).toBe("repost_amplification");
    expect(tactic?.headline).toContain("Özkan");
    expect(tactic?.strategy).toContain("outbids.lol");
    expect(tactic?.strategy).toContain("Expansion of content reach");
    expect(tactic?.recommendedActions.length).toBeGreaterThanOrEqual(3);
    expect(tactic?.suggestedDraft).toContain("@naxisty");
    expect(tactic?.agentPrompt).toContain("@naxisty");
    expect(tactic?.agentPrompt).toContain("Signals");
  });

  it("supports all 5 goals with distinct tactical recommendations", () => {
    const goals = [
      "follow_back",
      "repost_amplification",
      "mutual_engagement",
      "warm_conversation",
      "partnership",
    ] as const;

    for (const goal of goals) {
      const tactic = generateGoalTactic(mockContact, mockPersona, goal);
      expect(tactic).not.toBeNull();
      expect(tactic?.goal).toBe(goal);
      expect(tactic?.recommendedActions.length).toBeGreaterThanOrEqual(3);
      expect(tactic?.suggestedDraft.length).toBeGreaterThan(10);
      expect(tactic?.agentPrompt.length).toBeGreaterThan(10);
    }
  });

  it("gracefully falls back when persona data is empty", () => {
    const tactic = generateGoalTactic({
      id: "c2",
      name: "Alex Doe",
      relationshipGoal: "warm_conversation",
    }, null);

    expect(tactic).not.toBeNull();
    expect(tactic?.headline).toContain("Alex Doe");
    expect(tactic?.strategy).toBeTruthy();
    expect(tactic?.recommendedActions.length).toBeGreaterThanOrEqual(3);
  });
});
