import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db/client";
import { orgDomains } from "@/lib/db/schema";
import { createOrg } from "@/lib/db/queries/orgs";
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
});
