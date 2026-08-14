import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
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

  it("query_orgs excludes local_only orgs unless opted in", async () => {
    db.insert(orgs)
      .values({
        id: nanoid(),
        name: "Secret Org",
        scope: "local_only",
        source: "test",
      })
      .run();
    db.insert(orgs)
      .values({
        id: nanoid(),
        name: "Public Org",
        scope: "shared",
        source: "test",
      })
      .run();

    const defaultView = await invokeAgentTool("query_orgs", {});
    expect(defaultView).toMatchObject({ total: 1 });
    expect((defaultView as { orgs: { name: string }[] }).orgs[0]?.name).toBe("Public Org");

    const privateView = await invokeAgentTool("query_orgs", { includeLocalOnly: true });
    expect(privateView).toMatchObject({ total: 2 });
  });

  it("upsert_edge accepts interaction node endpoints", async () => {
    const created = await invokeAgentTool("create_contact", { name: "Interactor" });
    const contactId = (created as { id: string }).id;

    const interaction = await invokeAgentTool("log_interaction", {
      contactId,
      interactionType: "email",
      scope: "shared",
    });
    const interactionId = (interaction as { id: string }).id;

    const edge = await invokeAgentTool("upsert_edge", {
      srcType: "contact",
      srcId: contactId,
      dstType: "interaction",
      dstId: interactionId,
      edgeType: "had_interaction",
      scope: "shared",
    });

    expect(edge).toMatchObject({
      srcType: "contact",
      dstType: "interaction",
      edgeType: "had_interaction",
    });
  });

  it("query_graph omits private properties by default and includes them when opted in", async () => {
    const alice = createContact({ name: "Alice", platform: "x", platformUserId: "qa1" });
    const bob = createContact({ name: "Bob", platform: "x", platformUserId: "qb1" });

    await invokeAgentTool("upsert_edge", {
      srcType: "contact",
      srcId: alice.id,
      dstType: "contact",
      dstId: bob.id,
      edgeType: "relationship",
      propertiesPrivate: { private_notes: "secret dinner plans" },
      scope: "local_only",
    });

    const publicView = await invokeAgentTool("query_graph", {
      nodeType: "contact",
      nodeId: alice.id,
      edgeTypes: ["relationship"],
      direction: "outgoing",
    });
    expect((publicView as { edgeCount: number }).edgeCount).toBe(0);

    const privateView = await invokeAgentTool("query_graph", {
      nodeType: "contact",
      nodeId: alice.id,
      edgeTypes: ["relationship"],
      direction: "outgoing",
      includeLocalOnly: true,
    });
    const edges = (privateView as { edges: { propertiesPrivate?: Record<string, string> }[] }).edges;
    expect(edges).toHaveLength(1);
    expect(edges[0]?.propertiesPrivate).toEqual({ private_notes: "secret dinner plans" });
  });
});
