import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { invokeAgentTool } from "@/lib/agent-tools/invoke";
import { createContact } from "@/lib/db/queries/contacts";
import { syncContactCompanyGraph } from "@/lib/db/contact-org-dual-write";
import * as graphQueries from "@/lib/db/queries/graph";
import { db } from "@/lib/db/client";
import { contacts, graphEdges, orgs } from "@/lib/db/schema";
import { resetCoreTables } from "@/test/db";

describe("contact company graph sync", () => {
  beforeEach(() => {
    resetCoreTables();
  });

  it("retires prior works_at edges when company changes", () => {
    const contact = createContact({
      name: "Mover",
      company: "Acme Corp",
      platform: "x",
      platformUserId: "m1",
    });
    syncContactCompanyGraph(contact.id, "Acme Corp", "CEO");

    syncContactCompanyGraph(contact.id, "Beta LLC", "CTO", "agent:update_contact");

    const orgRows = db.select().from(orgs).all();
    expect(orgRows.map((o) => o.name).sort()).toEqual(["Acme Corp", "Beta LLC"]);

    const worksAt = db
      .select()
      .from(graphEdges)
      .where(eq(graphEdges.edgeType, "works_at"))
      .all();
    expect(worksAt).toHaveLength(1);
    expect(worksAt[0]?.dstId).toBe(orgRows.find((o) => o.name === "Beta LLC")?.id);
    expect(JSON.parse(worksAt[0]?.properties ?? "{}")).toMatchObject({
      title: "CTO",
      is_current: true,
    });
  });

  it("removes works_at edges when company is cleared", () => {
    const contact = createContact({
      name: "Leaver",
      company: "Acme Corp",
      platform: "x",
      platformUserId: "l1",
    });
    syncContactCompanyGraph(contact.id, "Acme Corp");

    const retired = syncContactCompanyGraph(contact.id, "", undefined, "agent:update_contact");
    expect(retired.retiredEdges).toBe(1);
    expect(db.select().from(graphEdges).all()).toHaveLength(0);
  });

  it("update_contact keeps a single current employer via agent tool", async () => {
    const created = await invokeAgentTool("create_contact", {
      name: "Updater",
      company: "Acme Corp",
      title: "CEO",
    });
    const contactId = (created as { id: string }).id;

    await invokeAgentTool("update_contact", {
      contactId,
      company: "Beta LLC",
      title: "Founder",
    });

    const worksAt = db
      .select()
      .from(graphEdges)
      .where(eq(graphEdges.edgeType, "works_at"))
      .all();
    expect(worksAt).toHaveLength(1);
    const beta = db.select().from(orgs).where(eq(orgs.name, "Beta LLC")).get();
    expect(worksAt[0]?.dstId).toBe(beta?.id);
  });

  it("update_contact refreshes works_at title when only title changes", async () => {
    const created = await invokeAgentTool("create_contact", {
      name: "Titled",
      company: "Acme Corp",
      title: "CEO",
    });
    const contactId = (created as { id: string }).id;

    await invokeAgentTool("update_contact", {
      contactId,
      title: "CTO",
    });

    const worksAt = db
      .select()
      .from(graphEdges)
      .where(eq(graphEdges.edgeType, "works_at"))
      .all();
    expect(JSON.parse(worksAt[0]?.properties ?? "{}")).toMatchObject({
      title: "CTO",
      is_current: true,
    });
  });

  it("rolls back create_contact when graph dual-write fails", async () => {
    vi.spyOn(graphQueries, "upsertGraphEdge").mockImplementation(() => {
      throw new Error("graph write failed");
    });

    await expect(
      invokeAgentTool("create_contact", { name: "Rollback", company: "Acme Corp" }),
    ).rejects.toThrow(/graph write failed/);

    expect(db.select().from(contacts).all()).toHaveLength(0);
  });
});
