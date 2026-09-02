import { describe, expect, it } from "vitest";
import autonomousContract from "../../../scripts/app-automation/scenarios/issue-413-autonomous-path.contract.mjs";
import {
  PUBLISH_CAPABLE_PLATFORMS,
  getSurfaceCapabilities,
} from "@/lib/writing/capabilities";
import { WRITING_INTENT_MANDATES } from "@/lib/writing/writing-intent";
import {
  NURTURE_APPROVAL_GATE_CONFIG_KEY,
  NURTURE_SURFACE_APPROVAL_FLOOR,
  readNurtureApprovalGate,
  resolveNurtureApprovalGate,
} from "@/lib/workflows/nurture-approval-gate";

describe("resolveNurtureApprovalGate", () => {
  it.each(["x", "linkedin", "facebook", null] as const)(
    "locks %s to explicit approval under the assist-only mandate",
    (platform) => {
      expect(resolveNurtureApprovalGate(platform)).toMatchObject({
        mode: "locked_explicit",
        reason: "assist_only_mandate",
        platform,
      });
    },
  );

  it("pins every direct-message floor to explicit regardless of registry capability", () => {
    for (const [surface, floor] of Object.entries(NURTURE_SURFACE_APPROVAL_FLOOR)) {
      if (!surface.endsWith("/direct_message")) continue;
      expect(floor).toBe("explicit");
      const platform = surface.split("/")[0] as "x" | "linkedin" | "facebook";
      const gate = resolveNurtureApprovalGate(platform, (candidate) => ({
        ...getSurfaceCapabilities(candidate),
        publish: "direct",
        mandate: null,
      }));
      expect(gate.surfaces.find((row) => row.surface === surface)).toMatchObject({
        approval: "explicit",
        reason: "explicit_floor",
      });
    }
  });

  it("unlocks only a capability-floor surface with a publish adapter and widened mandate", () => {
    const gate = resolveNurtureApprovalGate("x", (surface) =>
      surface === "x/reply"
        ? { ...getSurfaceCapabilities(surface), publish: "direct", mandate: null }
        : getSurfaceCapabilities(surface),
    );
    expect(gate).toMatchObject({ mode: "operator_choice", reason: "publish_capable" });
    expect(gate.surfaces).toEqual([
      expect.objectContaining({ surface: "x/reply", approval: "operator_choice" }),
      expect.objectContaining({ surface: "x/direct_message", approval: "explicit" }),
    ]);
  });

  it("round-trips only a server-stamped gate", () => {
    const gate = resolveNurtureApprovalGate("x");
    expect(readNurtureApprovalGate({ [NURTURE_APPROVAL_GATE_CONFIG_KEY]: gate })).toEqual(gate);
    expect(readNurtureApprovalGate({ [NURTURE_APPROVAL_GATE_CONFIG_KEY]: { mode: "locked_explicit" } })).toBeNull();
  });

  it("keeps the blocked contract tied to the live mandate and registry", () => {
    expect(autonomousContract.reachability.by).toBe(`${WRITING_INTENT_MANDATES[0]}_mandate`);
    for (const platform of PUBLISH_CAPABLE_PLATFORMS.filter((value) =>
      value === "x" || value === "linkedin" || value === "facebook",
    )) {
      expect(resolveNurtureApprovalGate(platform).mode).toBe("locked_explicit");
    }
  });
});
