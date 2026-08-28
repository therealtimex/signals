import { resolveMx } from "node:dns/promises";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { orgDomains } from "@/lib/db/schema";

export type MxResolver = (domain: string) => Promise<{ exchange: string; priority: number }[]>;

export async function checkOrgMailDomains(orgId: string, resolver: MxResolver = resolveMx) {
  const domains = db.select().from(orgDomains).where(eq(orgDomains.orgId, orgId)).all();
  const now = Math.floor(Date.now() / 1000);
  const results = await Promise.all(domains.map(async (domain) => {
    let mxStatus: "ok" | "none" | "error" = "error";
    let records: { exchange: string; priority: number }[] = [];
    try {
      records = await resolver(domain.domain);
      mxStatus = records.length ? "ok" : "none";
    } catch (error) {
      const code = typeof error === "object" && error && "code" in error ? String(error.code) : "UNKNOWN";
      mxStatus = code === "ENODATA" || code === "ENOTFOUND" ? "none" : "error";
    }
    db.update(orgDomains).set({
      mxStatus,
      mailCheckedAt: now,
      mailEvidence: JSON.stringify({ mx: records }),
      updatedAt: now,
    }).where(eq(orgDomains.id, domain.id)).run();
    return { domain: domain.domain, mxStatus, records };
  }));
  return results;
}
