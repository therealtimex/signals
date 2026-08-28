import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { orgDomains } from "@/lib/db/schema";
import { createOrg } from "@/lib/db/queries/orgs";
import { resetCoreTables } from "@/test/db";
import { checkOrgMailDomains } from "./mail-domains";

describe("company mail-domain checks", () => {
  beforeEach(resetCoreTables);

  it("stores MX evidence through an injected resolver", async () => {
    const org = createOrg({ name: "MX Co", domain: "mx.example" });
    const resolver = vi.fn().mockResolvedValue([{ exchange: "mail.mx.example", priority: 10 }]);
    await checkOrgMailDomains(org.id, resolver);
    expect(db.select().from(orgDomains).where(eq(orgDomains.orgId, org.id)).get()).toMatchObject({
      mxStatus: "ok",
      mailCheckedAt: expect.any(Number),
    });
  });
});
