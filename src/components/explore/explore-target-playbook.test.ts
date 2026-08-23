// @vitest-environment happy-dom

import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ExploreTargetPlaybook } from "@/components/explore/explore-target-playbook";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: vi.fn(),
  }),
}));

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

  it("renders Target Playbook card with strategy, action steps, and dispatch button", () => {
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
    expect(html).toContain("Dispatch to Nurture Agent");
    expect(html).toContain("Copy Prompt");
  });
});
