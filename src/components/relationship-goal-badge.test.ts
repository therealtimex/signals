// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  RelationshipGoalBadge,
  RelationshipGoalSelector,
} from "@/components/relationship-goal-badge";

describe("RelationshipGoalBadge", () => {
  it("renders null when goal is not provided or invalid", () => {
    expect(renderToStaticMarkup(createElement(RelationshipGoalBadge, { goal: null }))).toBe("");
    expect(renderToStaticMarkup(createElement(RelationshipGoalBadge, { goal: "invalid" }))).toBe("");
  });

  it("renders badge for each valid relationship goal with status", () => {
    const html = renderToStaticMarkup(
      createElement(RelationshipGoalBadge, {
        goal: "follow_back",
        status: "in_progress",
      }),
    );
    expect(html).toContain("Follow Back");

    const repostHtml = renderToStaticMarkup(
      createElement(RelationshipGoalBadge, {
        goal: "repost_amplification",
        status: "achieved",
      }),
    );
    expect(repostHtml).toContain("Repost &amp; Amplify");
  });
});

describe("RelationshipGoalSelector", () => {
  it("renders '+ Set Goal' button when no goal is selected", () => {
    const html = renderToStaticMarkup(
      createElement(RelationshipGoalSelector, {
        goal: null,
        status: "not_started",
        onSelect: () => {},
      }),
    );
    expect(html).toContain("+ Set Goal");
  });

  it("renders selected goal label and status when set", () => {
    const html = renderToStaticMarkup(
      createElement(RelationshipGoalSelector, {
        goal: "warm_conversation",
        status: "in_progress",
        onSelect: () => {},
      }),
    );
    expect(html).toContain("Warm Conversation");
    expect(html).toContain("In Progress");
  });
});
