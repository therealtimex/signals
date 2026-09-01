import { describe, expect, it } from "vitest";
import { PUBLISH_PLATFORM_TARGETS } from "@/lib/publish/payload";
import {
  PUBLISH_CAPABLE_PLATFORMS,
  canReachPublishAdapter,
  getSurfaceCapabilities,
  publishCapabilityForPlatform,
} from "@/lib/writing/capabilities";
import { NURTURE_WRITING_SURFACES } from "@/lib/writing/writing-intent";

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

  it("keeps the nurture surfaces out of the publish-capable platform derivation", () => {
    // A draft_only surface must never raise its platform's publish rank.
    expect(publishCapabilityForPlatform("x")).toBe("direct");
    expect(publishCapabilityForPlatform("linkedin")).toBe("beta");
    expect(publishCapabilityForPlatform("facebook")).toBe("direct");
  });
});
