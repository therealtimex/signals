import { beforeEach, describe, expect, it } from "vitest";
import { createOrg } from "@/lib/db/queries/orgs";
import { createContact } from "@/lib/db/queries/contacts";
import { createContactEmployment } from "@/lib/db/queries/contact-employments";
import { logInteraction } from "@/lib/db/queries/interactions";
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

  it("does not fan shared interactions through local-only employments", () => {
    const org = createOrg({ name: "Private Membership Co" });
    const contact = createContact({ name: "Private Member" });
    createContactEmployment({
      contactId: contact.id, orgId: org.id, scope: "local_only", source: "test",
    });
    logInteraction({
      contactId: contact.id, interactionType: "note", summary: "Shared interaction",
      scope: "shared", source: "test",
    });

    expect(listOrgTimeline(org.id)).toMatchObject({ total: 0, data: [] });
    expect(listOrgTimeline(org.id, { includeLocalOnly: true })).toMatchObject({ total: 1 });
  });
});
