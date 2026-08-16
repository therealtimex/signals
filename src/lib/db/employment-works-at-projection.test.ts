import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { createContact } from "@/lib/db/queries/contacts";
import { createContactEmployment } from "@/lib/db/queries/contact-employments";
import { createOrg } from "@/lib/db/queries/orgs";
import { db } from "@/lib/db/client";
import { graphEdges, orgs } from "@/lib/db/schema";
import { resetCoreTables } from "@/test/db";

function createLocalOrg(name: string) {
  const id = nanoid();
  db.insert(orgs)
    .values({
      id,
      name,
      orgType: "company",
      scope: "local_only",
      source: "test",
    })
    .run();
  return id;
}

describe("employment works_at projection", () => {
  beforeEach(() => {
    resetCoreTables();
  });

  it("projects local_only employments to local_only works_at edges", () => {
    const contact = createContact({ name: "Private" });
    const orgId = createLocalOrg("Secret Org");

    createContactEmployment({
      contactId: contact.id,
      orgId,
      title: "Hidden Role",
      scope: "local_only",
      source: "test",
    });

    const edge = db.select().from(graphEdges).where(eq(graphEdges.edgeType, "works_at")).get();
    expect(edge?.scope).toBe("local_only");
    expect(JSON.parse(edge?.properties ?? "{}")).toMatchObject({
      title: "Hidden Role",
      is_current: true,
    });
  });

  it("projects shared employments at local_only orgs as local_only works_at edges", () => {
    const contact = createContact({ name: "Scoped Org" });
    const orgId = createLocalOrg("Private Employer");

    createContactEmployment({
      contactId: contact.id,
      orgId,
      title: "Secret Role",
      scope: "shared",
      source: "test",
    });

    const edge = db.select().from(graphEdges).where(eq(graphEdges.edgeType, "works_at")).get();
    expect(edge?.scope).toBe("local_only");
  });

  it("keeps shared edge properties derived from shared stints only", () => {
    const contact = createContact({ name: "Mixed" });
    const org = createOrg({ name: "Acme Corp", source: "test" });

    createContactEmployment({
      contactId: contact.id,
      orgId: org.id,
      title: "Public CEO",
      scope: "shared",
      source: "test",
    });
    createContactEmployment({
      contactId: contact.id,
      orgId: org.id,
      title: "Secret Advisor",
      scope: "local_only",
      startedAt: 50,
      source: "test",
    });

    const edge = db.select().from(graphEdges).where(eq(graphEdges.edgeType, "works_at")).get();
    expect(edge?.scope).toBe("shared");
    expect(JSON.parse(edge?.properties ?? "{}")).toMatchObject({
      title: "Public CEO",
      is_current: true,
    });
  });
});
