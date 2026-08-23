// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ExploreTargetPlaybook } from "@/components/explore/explore-target-playbook";

describe("ExploreTargetPlaybook", () => {
  const mockContact = {
    id: "c1",
    name: "Özkan Taşlı",
    firstName: "Özkan",
    company: "outbids.lol",
    title: "Creator",
    platform: "x",
    platformHandle: "naxisty",
    relationshipGoal: "repost_amplification",
    relationshipGoalStatus: "not_started",
  };

  const mockPersona = {
    archetype: "Creator at Startup",
    tone: "Professional yet casual",
    summary: "Özkan is building outbids.lol",
    interests: ["Content creation", "Creator economy"],
    conversionTriggers: ["Expansion of content reach"],
    engagementFormats: ["Short-form video"],
  };

  it("renders Target Playbook card with strategy and action steps", () => {
    const html = renderToStaticMarkup(
      createElement(ExploreTargetPlaybook, {
        contact: mockContact,
        persona: mockPersona,
      }),
    );

    expect(html).toContain("Target Playbook");
    expect(html).toContain("Organic Amplification &amp; Repost Plan");
    expect(html).toContain("Recommended Action Steps");
    expect(html).toContain("Suggested Angle / Copy");
    expect(html).toContain("Copy Agent Instructions");
  });
});
