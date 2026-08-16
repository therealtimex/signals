import { beforeEach, describe, expect, it } from "vitest";
import {
  BROWSER_ENRICHMENT_UNAVAILABLE_CODE,
  syncXProfiles,
} from "@/lib/platforms/sync-x-profiles";
import { resetCoreTables } from "@/test/db";

describe("syncXProfiles", () => {
  beforeEach(() => {
    resetCoreTables();
  });

  it("returns browser enrichment unavailable without scraping", async () => {
    const result = await syncXProfiles("account-1", { maxProfiles: 5 });

    expect(result.added).toBe(0);
    expect(result.updated).toBe(0);
    expect(result.errors[0]).toContain(BROWSER_ENRICHMENT_UNAVAILABLE_CODE);
  });
});
