// @vitest-environment happy-dom

import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ContactNurtureFields } from "@/app/dashboard/workflows/contact-nurture-fields";
import { buildContactNurtureTemplateConfig, readContactNurtureConfig } from "@/lib/workflows/contact-relationship-nurture";
import {
  applyNurtureApprovalGate,
  resolveNurtureApprovalGate,
} from "@/lib/workflows/nurture-approval-gate";

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
      targetId: "target-1",
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
    expect(html).toContain('data-mode="locked_explicit"');
    expect(html).toContain('data-reason="assist_only_mandate"');
    expect(html).toContain("Approval before anything is sent");
    // State has to be visible in the control column, not only in prose: an
    // empty state column read as "nothing is enforcing approval".
    expect(html).toContain('data-testid="nurture-approval-state"');
    expect(html).toContain("Required");
    expect(html).toContain("Nothing is sent from this run");
    expect(html).toContain("every nurture surface on X is draft-only");
    // A derived gate is state, not a setting: no switch claims a choice that
    // does not exist, and no disabled control drops out of the tab order with
    // the explanation attached to it.
    expect(html).not.toContain('id="nurture-approval"');
    expect(html).not.toContain("nurture-approval-reason");
    expect(html).not.toContain("Require approval before anything is sent");
    // The switch next to it is a real setting and stays one.
    expect(html).toContain('id="nurture-auto-achieve"');
    expect(html).toContain("X reply");
    expect(html).toContain("X DM");
    expect(html).toContain("always explicit");
    expect(html).toContain("Maximum comments, spotlights, or DMs to propose in this run.");
    expect(html).not.toContain("full autonomous execution");
    expect(html).toContain("Auto-achieve on milestone");
  });

  it("forces a stale false value to true while the gate is locked", () => {
    const config = readContactNurtureConfig(
      buildContactNurtureTemplateConfig({ requireApproval: false }),
    );
    expect(applyNurtureApprovalGate(config, resolveNurtureApprovalGate("x"))).toMatchObject({
      requireApproval: true,
    });
  });

  it("preserves operator choice under a future unlocked gate", () => {
    const config = readContactNurtureConfig(
      buildContactNurtureTemplateConfig({ requireApproval: false }),
    );
    expect(applyNurtureApprovalGate(config, {
      ...resolveNurtureApprovalGate("x"),
      mode: "operator_choice",
      reason: "publish_capable",
    })).toMatchObject({ requireApproval: false });
  });

  it("renders the future operator-choice state as enabled and keeps DM explicit", () => {
    const config = readContactNurtureConfig(
      buildContactNurtureTemplateConfig({ requireApproval: false }),
    );
    const locked = resolveNurtureApprovalGate("x");
    const html = renderToStaticMarkup(
      createElement(ContactNurtureFields, {
        value: config,
        onChange: vi.fn(),
        approvalGateOverride: {
          ...locked,
          mode: "operator_choice",
          reason: "publish_capable",
          surfaces: locked.surfaces.map((surface) => surface.surface === "x/reply"
            ? {
                ...surface,
                publish: "direct" as const,
                mandate: null,
                approval: "operator_choice" as const,
                reason: "publish_capable" as const,
              }
            : surface),
        },
      }),
    );

    expect(html).toContain('data-mode="operator_choice"');
    expect(html).toContain("Public surfaces with a publish adapter may run without a second prompt");
    expect(html).toContain("operator choice");
    expect(html).toContain("always explicit");
    // The switch only exists where there is a decision to make, and there it is
    // a real one.
    expect(html).toContain("Require approval before anything is sent");
    expect(html).toContain('id="nurture-approval"');
    expect(html).not.toMatch(/id="nurture-approval"[^>]*disabled/);
    expect(html).not.toContain('data-testid="nurture-approval-state"');
  });
});
