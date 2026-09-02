import { describe, expect, it } from "vitest";
import { PUBLISH_PLATFORM_TARGETS } from "@/lib/publish/payload";
import {
  ASSIST_ONLY_SURFACES,
  PUBLISH_CAPABLE_PLATFORMS,
  canReachPublishAdapter,
  getSurfaceCapabilities,
  isAssistOnlySurface,
  publishCapabilityForPlatform,
} from "@/lib/writing/capabilities";
import { NURTURE_WRITING_SURFACES } from "@/lib/writing/writing-intent";
import { SURFACE_IDS } from "@/lib/writing/surfaces";

describe("writing capability registry", () => {
  it("cannot drift from the deterministic publish lane", () => {
    expect(new Set(PUBLISH_CAPABLE_PLATFORMS)).toEqual(new Set(PUBLISH_PLATFORM_TARGETS));
  });

  it("reports direct, beta, draft-only, and export-only honestly", () => {
    expect(getSurfaceCapabilities("x/thread").publish).toBe("direct");
    expect(getSurfaceCapabilities("linkedin/post").publish).toBe("beta");
    expect(getSurfaceCapabilities("threads/post").publish).toBe("draft_only");
    expect(getSurfaceCapabilities("youtube/thumbnail_brief").publish).toBe("export_only");
    expect(publishCapabilityForPlatform("facebook")).toBe("direct");
    expect(publishCapabilityForPlatform("instagram")).toBe("draft_only");
  });

  it("makes every nurture surface draftable, auditable, and unsendable", () => {
    for (const surface of NURTURE_WRITING_SURFACES) {
      const capability = getSurfaceCapabilities(surface);
      expect(capability.draft).toBe("supported");
      expect(capability.audit).toBe("supported");
      expect(capability.publish).toBe("draft_only");
      expect(capability.engage).toBe("unsupported");
      expect(canReachPublishAdapter(capability.publish)).toBe(false);
    }
  });

  it("admits only direct and beta capabilities to a publish adapter", () => {
    expect(canReachPublishAdapter("direct")).toBe(true);
    expect(canReachPublishAdapter("beta")).toBe(true);
    expect(canReachPublishAdapter("draft_only")).toBe(false);
    expect(canReachPublishAdapter("export_only")).toBe(false);
    expect(canReachPublishAdapter("unsupported")).toBe(false);
  });

  it("carries the assist-only mandate on the surface itself", () => {
    // The mandate must not depend on a caller-supplied pointer, so it lives in the capability row.
    expect(new Set(ASSIST_ONLY_SURFACES)).toEqual(new Set(NURTURE_WRITING_SURFACES));
    for (const surface of SURFACE_IDS) {
      expect(isAssistOnlySurface(surface)).toBe(
        (NURTURE_WRITING_SURFACES as readonly string[]).includes(surface),
      );
      // No surface may be both sendable and assist-only.
      if (isAssistOnlySurface(surface)) {
        expect(canReachPublishAdapter(getSurfaceCapabilities(surface).publish)).toBe(false);
      }
    }
  });

  it("keeps the nurture surfaces out of the publish-capable platform derivation", () => {
    // A draft_only surface must never raise its platform's publish rank.
    expect(publishCapabilityForPlatform("x")).toBe("direct");
    expect(publishCapabilityForPlatform("linkedin")).toBe("beta");
    expect(publishCapabilityForPlatform("facebook")).toBe("direct");
  });
});
