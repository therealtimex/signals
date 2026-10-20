import { describe, expect, it } from "vitest";
import {
  OBJECTIVE_BRIEF_TEMPLATE,
  extractObjectiveMentions,
  parseObjectiveBrief,
} from "@/lib/writing/objective-brief";

describe("parseObjectiveBrief", () => {
  it("parses the five headings in any order and at levels 1-3, case-insensitively", () => {
    const parsed = parseObjectiveBrief([
      "Intro text that is kept but not parsed.",
      "",
      "### success",
      "A reply naming their current workflow.",
      "",
      "# OUTCOME",
      "Agree to a 20-minute evaluation",
      "of the engineering workflow.",
      "",
      "Second paragraph is not the outcome.",
      "",
      "## Fit:",
      "Technical founder hiring engineers.",
      "",
      "## Next  Step",
      "Ask which workflow they use for new hires.",
      "",
      "## Unknowns",
      "1. Whether they use a coding agent today",
      "2. Who owns onboarding",
      "   for new engineers",
      "",
    ].join("\n"));

    expect(parsed).toEqual({
      outcome: "Agree to a 20-minute evaluation of the engineering workflow.",
      fit: "Technical founder hiring engineers.",
      unknowns: ["Whether they use a coding agent today", "Who owns onboarding for new engineers"],
      nextStep: "Ask which workflow they use for new hires.",
      success: "A reply naming their current workflow.",
    });
  });

  it("reads the untouched dialog template as empty, including its blank list item", () => {
    expect(parseObjectiveBrief(OBJECTIVE_BRIEF_TEMPLATE)).toEqual({
      outcome: null,
      fit: null,
      unknowns: [],
      nextStep: null,
      success: null,
    });
  });

  it("treats prose under Unknowns as one item and bounds lists to twelve", () => {
    expect(parseObjectiveBrief("## Unknowns\nWhether the team\nalready budgets for tooling.").unknowns)
      .toEqual(["Whether the team already budgets for tooling."]);
    const many = Array.from({ length: 15 }, (_, index) => `- unknown ${index + 1}`).join("\n");
    expect(parseObjectiveBrief(`## Unknowns\n${many}`).unknowns).toHaveLength(12);
  });

  it("keeps the first occurrence of a heading and ends a section at the next heading", () => {
    const parsed = parseObjectiveBrief([
      "## Outcome",
      "First outcome.",
      "## Notes",
      "Not part of the outcome.",
      "## Outcome",
      "Second outcome is ignored.",
    ].join("\n"));
    expect(parsed.outcome).toBe("First outcome.");
  });

  it("ignores headings inside fenced code blocks", () => {
    const parsed = parseObjectiveBrief([
      "## Fit",
      "Platform teams.",
      "```",
      "## Outcome",
      "not a heading",
      "```",
    ].join("\n"));
    expect(parsed.outcome).toBeNull();
    expect(parsed.fit).toBe("Platform teams.");
  });

  it("cuts parsed fields to their bounds", () => {
    const parsed = parseObjectiveBrief(`## Outcome\n${"x".repeat(900)}\n## Unknowns\n- ${"y".repeat(400)}`);
    expect(parsed.outcome).toHaveLength(500);
    expect(parsed.outcome!.endsWith("…")).toBe(true);
    expect(parsed.unknowns[0]).toHaveLength(300);
  });
});

describe("extractObjectiveMentions", () => {
  it("finds allowlisted file and PRODUCTS.md entry mentions in order, deduplicated", () => {
    expect(extractObjectiveMentions(
      "Pitch @PRODUCTS.md#engineering-workflow (see @BRAND.md), not @PRODUCTS.md#engineering-workflow again; @SOUL.md.",
    )).toEqual([
      { raw: "@PRODUCTS.md#engineering-workflow", path: "PRODUCTS.md", anchor: "engineering-workflow" },
      { raw: "@BRAND.md", path: "BRAND.md", anchor: null },
      { raw: "@SOUL.md", path: "SOUL.md", anchor: null },
    ]);
  });

  it("keeps an anchor on a non-PRODUCTS file so it can be reported as unresolved", () => {
    expect(extractObjectiveMentions("@BRAND.md#voice")).toEqual([
      { raw: "@BRAND.md#voice", path: "BRAND.md", anchor: "voice" },
    ]);
  });

  it("refuses paths outside the allowlist, wrong case, email-like and extended tokens", () => {
    expect(extractObjectiveMentions([
      "@objectives/eng.md",
      "@brand.md",
      "@AGENTS.md",
      "name@BRAND.md",
      "@BRAND.mdx",
      "@PRODUCTS.md#Bad_Slug",
    ].join(" "))).toEqual([]);
  });
});
