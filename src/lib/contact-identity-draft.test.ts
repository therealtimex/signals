import { describe, expect, it } from "vitest";
import { PLATFORMS } from "@/lib/db/platforms";
import { CRM_IDENTITY_PLATFORMS, platformLabels } from "@/lib/contact-identity-draft";

describe("CRM identity platforms", () => {
  it("offers every registered platform in the identity picker", () => {
    expect(CRM_IDENTITY_PLATFORMS).toEqual(PLATFORMS);
    expect(platformLabels.x).toBe("X / Twitter");
    expect(platformLabels.facebook).toBe("Facebook");
    expect(platformLabels.instagram).toBe("Instagram");
    expect(platformLabels.youtube).toBe("YouTube");
  });
});
