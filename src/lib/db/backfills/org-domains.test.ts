import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db/client";
import { orgDomains, orgs } from "@/lib/db/schema";
import { createOrg, getOrgByDomain } from "@/lib/db/queries/orgs";
import { backfillOrgDomains } from "./org-domains";
import { resetCoreTables } from "@/test/db";

describe("company domain backfill", () => {
  beforeEach(() => resetCoreTables());

  it("is idempotent for legacy org domain projections", () => {
    createOrg({ name: "Legacy", domain: "legacy.example" });
    db.delete(orgDomains).run();

    expect(backfillOrgDomains()).toMatchObject({ inserted: 1 });
    expect(backfillOrgDomains()).toMatchObject({ inserted: 0 });
    expect(db.select().from(orgDomains).all()).toMatchObject([
      { domain: "legacy.example", kind: "primary", source: "backfill:orgs-domain" },
    ]);
  });

  it("normalizes legacy URLs and resolves canonical duplicates deterministically", () => {
    db.insert(orgs).values([
      { id: "org-a-url", name: "URL Co", domain: "https://www.Acme.com/about" },
      { id: "org-z-canonical", name: "Canonical Co", domain: "Acme.COM" },
    ]).run();

    expect(backfillOrgDomains()).toMatchObject({ inserted: 1, conflicts: 1 });
    expect(getOrgByDomain("acme.com")?.id).toBe("org-a-url");
    expect(db.select().from(orgDomains).all()).toHaveLength(1);
    expect(db.select().from(orgDomains).all()[0]).toMatchObject({ domain: "acme.com", kind: "primary" });
    expect(backfillOrgDomains()).toMatchObject({ inserted: 0, conflicts: 0 });
  });
});
