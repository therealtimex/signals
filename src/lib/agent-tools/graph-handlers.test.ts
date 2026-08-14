import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { invokeAgentTool } from "@/lib/agent-tools/invoke";
import { createContact } from "@/lib/db/queries/contacts";
import { db } from "@/lib/db/client";
import { graphEdges, orgs } from "@/lib/db/schema";
import { resetCoreTables } from "@/test/db";

describe("graph agent tools", () => {
  beforeEach(() => {
    resetCoreTables();
  });

  it("dual-writes company to org + works_at on create_contact", async () => {
    const result = await invokeAgentTool("create_contact", {
      name: "Graph Agent",
      company: "Graph Corp",
      title: "Founder",
    });

    expect(result).toMatchObject({ company: "Graph Corp" });

    const orgRows = db.select().from(orgs).all();
    expect(orgRows).toHaveLength(1);
    expect(orgRows[0]?.name).toBe("Graph Corp");

    const edges = db.select().from(graphEdges).all();
    expect(edges).toHaveLength(1);
    expect(edges[0]?.edgeType).toBe("works_at");
  });

  it("query_orgs and query_graph return graph data", async () => {
    const contact = createContact({
      name: "Neighbor",
      company: "Neighbor LLC",
      platform: "x",
      platformUserId: "n1",
    });

    await invokeAgentTool("create_contact", {
      name: "Other",
      company: "Neighbor LLC",
    });

    const org = db.select().from(orgs).where(eq(orgs.name, "Neighbor LLC")).get();
    expect(org).toBeTruthy();

    const orgsResult = await invokeAgentTool("query_orgs", { search: "Neighbor" });
    expect(orgsResult).toMatchObject({ total: 1 });

    const graphResult = await invokeAgentTool("query_graph", {
      nodeType: "contact",
      nodeId: contact.id,
      direction: "outgoing",
    });
    expect((graphResult as { edgeCount: number }).edgeCount).toBeGreaterThanOrEqual(0);
  });

  it("log_interaction appends an interaction row", async () => {
    const created = await invokeAgentTool("create_contact", { name: "Logger" });
    const contactId = (created as { id: string }).id;

    const result = await invokeAgentTool("log_interaction", {
      contactId,
      interactionType: "meeting",
      summary: "Coffee chat",
      scope: "shared",
    });

    expect(result).toMatchObject({
      interactionType: "meeting",
      scope: "shared",
    });
  });
});
