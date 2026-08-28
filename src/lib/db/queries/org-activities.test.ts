import { beforeEach, describe, expect, it } from "vitest";
import { createOrg } from "@/lib/db/queries/orgs";
import { listOrgTimeline, logOrgActivity } from "./org-activities";
import { resetCoreTables } from "@/test/db";

describe("company activities", () => {
  beforeEach(() => resetCoreTables());

  it("deduplicates cited signals and exposes human-readable provenance", () => {
    const org = createOrg({ name: "Signal Co" });
    const input = {
      orgId: org.id,
      activityType: "funding",
      title: "Raised a round",
      url: "https://news.example/round",
      dedupeKey: "https://news.example/round",
      source: "agent:signal_scan",
    };
    expect(logOrgActivity(input).created).toBe(true);
    expect(logOrgActivity(input).created).toBe(false);
    expect(listOrgTimeline(org.id)).toMatchObject({
      total: 1,
      data: [{ sourceLabel: "Agent scan", sourceDetail: "agent:signal_scan" }],
    });
  });
});
