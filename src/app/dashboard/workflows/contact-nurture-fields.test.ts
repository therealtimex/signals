// @vitest-environment happy-dom

import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ContactNurtureFields } from "@/app/dashboard/workflows/contact-nurture-fields";
import { buildContactNurtureTemplateConfig, readContactNurtureConfig } from "@/lib/workflows/contact-relationship-nurture";

vi.mock("@/app/dashboard/workflows/use-acting-targets", () => ({
  useActingTargets: () => [
    {
      id: "target-1",
      platform: "x",
      name: "Trung Le",
      handle: "@trungle_rta_vn",
    },
  ],
}));

describe("ContactNurtureFields", () => {
  it("renders acting profile selector, goal scope, sliders, and approval toggles", () => {
    const config = readContactNurtureConfig(buildContactNurtureTemplateConfig({
      maxTargets: 15,
      maxActionsPerRun: 8,
      delayBetweenActionsSeconds: 45,
      requireApproval: true,
      autoAchieveOnMilestone: true,
    }));

    const html = renderToStaticMarkup(
      createElement(ContactNurtureFields, {
        value: config,
        onChange: vi.fn(),
      }),
    );

    expect(html).toContain("Acting profile");
    expect(html).toContain("Relationship goal scope");
    expect(html).toContain("Shift budget &amp; pacing");
    expect(html).toContain("Target contacts to inspect");
    expect(html).toContain("15 contacts");
    expect(html).toContain("Max actions budget");
    expect(html).toContain("8 actions");
    expect(html).toContain("Safety sleep delay");
    expect(html).toContain("45s delay");
    expect(html).toContain("Require confirmation before publishing");
    expect(html).toContain("Auto-achieve on milestone");
  });
});
