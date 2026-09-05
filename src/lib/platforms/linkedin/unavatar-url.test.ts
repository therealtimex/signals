import { describe, expect, it } from "vitest";
import {
  buildLinkedInUnavatarCandidates,
  buildLinkedInUnavatarUrl,
  isLinkedInVanitySlug,
} from "@/lib/platforms/linkedin/unavatar-url";

describe("buildLinkedInUnavatarUrl", () => {
  it("builds documented user: path for vanity slugs", () => {
    expect(buildLinkedInUnavatarUrl("timi-digifa")).toBe(
      "https://unavatar.io/linkedin/user:timi-digifa",
    );
    expect(buildLinkedInUnavatarUrl("@nitik-singh-chief-editor")).toBe(
      "https://unavatar.io/linkedin/user:nitik-singh-chief-editor",
    );
  });

  it("builds the company: path for organization pages", () => {
    expect(buildLinkedInUnavatarUrl("a16zspeedrun", "company")).toBe(
      "https://unavatar.io/linkedin/company:a16zspeedrun",
    );
  });

  it("rejects empty and invalid slugs", () => {
    expect(buildLinkedInUnavatarUrl("")).toBeUndefined();
    expect(buildLinkedInUnavatarUrl("-bad")).toBeUndefined();
    expect(buildLinkedInUnavatarUrl("-bad", "company")).toBeUndefined();
    expect(isLinkedInVanitySlug("")).toBe(false);
  });
});

describe("buildLinkedInUnavatarCandidates", () => {
  it("offers both namespaces, person first", () => {
    expect(buildLinkedInUnavatarCandidates("lux-capital")).toEqual([
      "https://unavatar.io/linkedin/user:lux-capital",
      "https://unavatar.io/linkedin/company:lux-capital",
    ]);
  });

  it("returns nothing for an invalid slug", () => {
    expect(buildLinkedInUnavatarCandidates("-bad")).toEqual([]);
  });
});
