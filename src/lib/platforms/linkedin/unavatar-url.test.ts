import { describe, expect, it } from "vitest";
import { buildLinkedInUnavatarUrl, isLinkedInVanitySlug } from "@/lib/platforms/linkedin/unavatar-url";

describe("buildLinkedInUnavatarUrl", () => {
  it("builds documented user: path for vanity slugs", () => {
    expect(buildLinkedInUnavatarUrl("timi-digifa")).toBe(
      "https://unavatar.io/linkedin/user:timi-digifa",
    );
    expect(buildLinkedInUnavatarUrl("@nitik-singh-chief-editor")).toBe(
      "https://unavatar.io/linkedin/user:nitik-singh-chief-editor",
    );
  });

  it("rejects empty and invalid slugs", () => {
    expect(buildLinkedInUnavatarUrl("")).toBeUndefined();
    expect(buildLinkedInUnavatarUrl("-bad")).toBeUndefined();
    expect(isLinkedInVanitySlug("")).toBe(false);
  });
});
