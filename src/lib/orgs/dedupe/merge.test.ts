import { beforeEach, describe, expect, it } from "vitest";
import { nanoid } from "nanoid";
import { createContact } from "@/lib/db/queries/contacts";
import { dualWriteContactCompany } from "@/lib/db/contact-org-dual-write";
import {
  createOrg,
  ensureOrgByName,
  listOrgsWithContactCounts,
  getOrgById,
} from "@/lib/db/queries/orgs";
import { db, sqlite } from "@/lib/db/client";
import { contactEmployments, orgDomains, orgEmailPatterns, graphEdges } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { mergeOrgs, MergeOrgsError, mergedIntoOrgId, resolveSurvivingOrgId } from "@/lib/orgs/dedupe/merge";
import { resetCoreTables } from "@/test/db";

function employ(name: string, orgName: string, title: string) {
  const contact = createContact({ name });
  dualWriteContactCompany(contact.id, orgName, title);
  return contact;
}

/**
 * `dualWriteContactCompany` retires a contact's previous `works_at` edge, so it cannot express
 * "employed at both orgs" — the state a merge collision needs. Insert the rows directly.
 */
function employAt(contactId: string, orgId: string, title: string | null, startedAt?: number) {
  const id = nanoid();
  db.insert(contactEmployments)
    .values({
      id,
      contactId,
      orgId,
      title,
      startedAt: startedAt ?? null,
      isCurrent: true,
      source: "test",
    })
    .run();
  return id;
}

describe("mergeOrgs", () => {
  beforeEach(() => resetCoreTables());

  it("dry run is the real transaction rolled back, so the report is exact", () => {
    const survivor = createOrg({ name: "Survivor", source: "test" });
    const doomed = createOrg({ name: "Doomed", source: "test" });
    employ("Person A", "Doomed", "Engineer");

    const dry = mergeOrgs({
      primaryOrgId: survivor.id,
      secondaryOrgIds: [doomed.id],
      options: { dryRun: true },
    });
    // Nothing was written.
    expect(mergedIntoOrgId(getOrgById(doomed.id)?.metadata)).toBeNull();

    const real = mergeOrgs({ primaryOrgId: survivor.id, secondaryOrgIds: [doomed.id] });
    expect({ ...dry, dryRun: false }).toEqual(real);
    expect(mergedIntoOrgId(getOrgById(doomed.id)?.metadata)).toBe(survivor.id);
  });

  it("leaves no row anywhere pointing at the tombstone", () => {
    const survivor = createOrg({ name: "Keeper", domain: "keeper.com", source: "test" });
    const doomed = createOrg({ name: "Goner", domain: "goner.com", source: "test" });
    employ("Employee", "Goner", "Engineer");
    db.insert(orgEmailPatterns)
      .values({ id: nanoid(), orgId: doomed.id, pattern: "{first}", rank: 1, confidence: "medium", score: 0.5, evaluatedAt: 0, source: "test" })
      .run();

    mergeOrgs({ primaryOrgId: survivor.id, secondaryOrgIds: [doomed.id] });

    // Enumerated from the schema rather than a hand-written list, so a new org_id column is caught.
    const columns = sqlite
      .prepare(
        `SELECT m.name AS tbl, p.name AS col
           FROM sqlite_master m JOIN pragma_table_info(m.name) p
          WHERE m.type = 'table' AND p.name LIKE '%org_id%'`,
      )
      .all() as { tbl: string; col: string }[];
    expect(columns.length).toBeGreaterThan(5);

    for (const { tbl, col } of columns) {
      const row = sqlite
        .prepare(`SELECT COUNT(*) AS n FROM "${tbl}" WHERE "${col}" = ?`)
        .get(doomed.id) as { n: number };
      expect(`${tbl}.${col}=${row.n}`).toBe(`${tbl}.${col}=0`);
    }
    for (const side of ["src", "dst"] as const) {
      const row = sqlite
        .prepare(`SELECT COUNT(*) AS n FROM graph_edges WHERE ${side}_type='org' AND ${side}_id = ?`)
        .get(doomed.id) as { n: number };
      expect(`graph_edges.${side}=${row.n}`).toBe(`graph_edges.${side}=0`);
    }
  });

  it("keeps the survivor's domain and demotes the rest to aliases", () => {
    const survivor = createOrg({ name: "Alpha", domain: "alpha.com", source: "test" });
    const doomed = createOrg({ name: "Alpha Two", domain: "alpha-two.com", source: "test" });

    const result = mergeOrgs({ primaryOrgId: survivor.id, secondaryOrgIds: [doomed.id] });

    expect(result.plan.domain.primary).toBe("alpha.com");
    expect(result.plan.domain.aliases.map((a) => a.domain)).toContain("alpha-two.com");
    expect(getOrgById(survivor.id)?.domain).toBe("alpha.com");
    expect(getOrgById(doomed.id)?.domain).toBeNull();
    const aliases = db.select().from(orgDomains).where(eq(orgDomains.orgId, survivor.id)).all();
    expect(aliases.map((a) => a.domain).sort()).toEqual(["alpha-two.com", "alpha.com"]);
  });

  it("adopts the secondary's domain when the survivor has none", () => {
    const survivor = createOrg({ name: "Beta", source: "test" });
    const doomed = createOrg({ name: "Beta Two", domain: "beta-two.com", source: "test" });

    const result = mergeOrgs({ primaryOrgId: survivor.id, secondaryOrgIds: [doomed.id] });

    expect(result.plan.domain.primary).toBe("beta-two.com");
    expect(getOrgById(survivor.id)?.domain).toBe("beta-two.com");
  });

  it("honours an explicit domain override and rejects one that belongs to nobody", () => {
    const survivor = createOrg({ name: "Gamma", domain: "gamma.com", source: "test" });
    const doomed = createOrg({ name: "Gamma Two", domain: "gamma-two.com", source: "test" });

    const result = mergeOrgs({
      primaryOrgId: survivor.id,
      secondaryOrgIds: [doomed.id],
      options: { domain: "gamma-two.com" },
    });
    expect(result.plan.domain.primary).toBe("gamma-two.com");
    expect(getOrgById(survivor.id)?.domain).toBe("gamma-two.com");

    const a = createOrg({ name: "Delta", source: "test" });
    const b = createOrg({ name: "Delta Two", source: "test" });
    expect(() =>
      mergeOrgs({ primaryOrgId: a.id, secondaryOrgIds: [b.id], options: { domain: "nobody.com" } }),
    ).toThrow(MergeOrgsError);
  });

  it("folds an employment on an equal or blank title and keeps distinct ones as stints", () => {
    // Deliberately not "Foldco" / "Foldco Ltd": orgNameKey strips corporate suffixes, so those two
    // are one org and ensureOrgByName would hand back the same record.
    const survivor = ensureOrgByName("Foldco Alpha");
    const doomed = ensureOrgByName("Foldco Beta");

    const equal = createContact({ name: "Equal Title" });
    employAt(equal.id, survivor.id, "Engineer");
    employAt(equal.id, doomed.id, "engineer");

    const blank = createContact({ name: "Blank Title" });
    employAt(blank.id, survivor.id, null);
    employAt(blank.id, doomed.id, "Engineer");

    const distinct = createContact({ name: "Distinct Title" });
    employAt(distinct.id, survivor.id, "Engineer");
    employAt(distinct.id, doomed.id, "Chief Scientist");
    const result = mergeOrgs({ primaryOrgId: survivor.id, secondaryOrgIds: [doomed.id] });

    const byContact = new Map(result.plan.employments.map((e) => [e.contactId, e.action]));
    expect(byContact.get(equal.id)).toBe("fold");
    // A blank title on either side means "same job, less detail", not a second job.
    expect(byContact.get(blank.id)).toBe("fold");
    expect(byContact.get(distinct.id)).toBe("stint");
    expect(result.dropped.contactEmployments).toBe(2);

    const equalRows = db
      .select()
      .from(contactEmployments)
      .where(eq(contactEmployments.contactId, equal.id))
      .all();
    expect(equalRows).toHaveLength(1);
  });

  it("never folds two rows whose start dates disagree", () => {
    const survivor = createOrg({ name: "Rehire", source: "test" });
    const doomed = createOrg({ name: "Rehire Inc", source: "test" });
    const contact = createContact({ name: "Boomerang" });

    employAt(contact.id, survivor.id, "Engineer", 1_600_000_000);
    employAt(contact.id, doomed.id, "Engineer", 1_700_000_000);

    const result = mergeOrgs({ primaryOrgId: survivor.id, secondaryOrgIds: [doomed.id] });

    expect(result.plan.employments[0]?.action).toBe("stint");
    expect(
      db.select().from(contactEmployments).where(eq(contactEmployments.contactId, contact.id)).all(),
    ).toHaveLength(2);
  });

  it("drops a colliding email pattern and a colliding graph edge", () => {
    const survivor = createOrg({ name: "Collide", source: "test" });
    const doomed = createOrg({ name: "Collide Inc", source: "test" });
    for (const orgId of [survivor.id, doomed.id]) {
      db.insert(orgEmailPatterns)
        .values({ id: nanoid(), orgId, pattern: "{first}.{last}", rank: 1, confidence: "medium", score: 0.5, evaluatedAt: 0, source: "test" })
        .run();
    }
    const contact = createContact({ name: "Edge Person" });
    for (const orgId of [survivor.id, doomed.id]) {
      db.insert(graphEdges)
        .values({
          id: nanoid(),
          srcType: "contact",
          srcId: contact.id,
          dstType: "org",
          dstId: orgId,
          edgeType: "follows",
          scope: "shared",
          source: "test",
        })
        .run();
    }

    const result = mergeOrgs({ primaryOrgId: survivor.id, secondaryOrgIds: [doomed.id] });

    expect(result.dropped.orgEmailPatterns).toBe(1);
    expect(result.dropped.graphEdges).toBeGreaterThanOrEqual(1);
    expect(
      db.select().from(orgEmailPatterns).where(eq(orgEmailPatterns.orgId, survivor.id)).all(),
    ).toHaveLength(1);
  });

  it("makes the merge durable: name lookup resolves and the list hides the tombstone", () => {
    const survivor = createOrg({ name: "Durable Co", source: "test" });
    const doomed = createOrg({ name: "Durable Company", source: "test" });

    mergeOrgs({ primaryOrgId: survivor.id, secondaryOrgIds: [doomed.id] });

    // Without this the next import re-attaches to the tombstone and the merge un-happens.
    expect(ensureOrgByName("Durable Company").id).toBe(survivor.id);
    expect(resolveSurvivingOrgId(doomed.id)).toBe(survivor.id);

    const listed = listOrgsWithContactCounts({ pageSize: 100 }).data.map((o) => o.id);
    expect(listed).toContain(survivor.id);
    expect(listed).not.toContain(doomed.id);
  });

  it("refuses a self-merge, an empty set, and an oversized batch", () => {
    const org = createOrg({ name: "Guarded", source: "test" });
    expect(() => mergeOrgs({ primaryOrgId: org.id, secondaryOrgIds: [org.id] })).toThrow(/itself/);
    expect(() => mergeOrgs({ primaryOrgId: org.id, secondaryOrgIds: [] })).toThrow(/at least one/i);
    expect(() =>
      mergeOrgs({ primaryOrgId: org.id, secondaryOrgIds: Array.from({ length: 21 }, () => nanoid()) }),
    ).toThrow(/at most/i);
  });

  it("reports an already-merged secondary instead of merging it twice", () => {
    const survivor = createOrg({ name: "Idem", source: "test" });
    const doomed = createOrg({ name: "Idem Two", source: "test" });

    mergeOrgs({ primaryOrgId: survivor.id, secondaryOrgIds: [doomed.id] });
    const again = mergeOrgs({ primaryOrgId: survivor.id, secondaryOrgIds: [doomed.id] });

    expect(again.merged[0]?.status).toBe("already_merged");
  });
});
