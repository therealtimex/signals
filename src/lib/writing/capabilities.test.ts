import { describe, expect, it } from "vitest";
import { PUBLISH_PLATFORM_TARGETS } from "@/lib/publish/payload";
import {
  PUBLISH_CAPABLE_PLATFORMS,
  getSurfaceCapabilities,
  publishCapabilityForPlatform,
} from "@/lib/writing/capabilities";

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
});
