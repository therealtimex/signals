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

  it("renders in_progress feedback badge and re-dispatch button", () => {
    const html = renderToStaticMarkup(
      createElement(ExploreTargetPlaybook, {
        contact: {
          ...mockContact,
          relationshipGoalStatus: "in_progress",
        },
        persona: mockPersona,
      }),
    );

    expect(html).toContain("In Progress");
    expect(html).toContain("In Progress · Re-dispatch Agent Task");
    expect(html).toContain("Active Agent Nurture Task Staged");
  });

  it("renders achieved milestone feedback and re-run button", () => {
    const html = renderToStaticMarkup(
      createElement(ExploreTargetPlaybook, {
        contact: {
          ...mockContact,
          relationshipGoalStatus: "achieved",
        },
        persona: mockPersona,
      }),
    );

    expect(html).toContain("Achieved");
    expect(html).toContain("Goal Achieved · Re-run Sequence");
    expect(html).toContain("Relationship Goal Achieved!");
  });
});
