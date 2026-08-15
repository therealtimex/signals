import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createContact, archiveContact } from "@/lib/db/queries/contacts";
import { logInteraction } from "@/lib/db/queries/interactions";
import { upsertGraphEdge } from "@/lib/db/queries/graph";
import {
  auditGraphIntegrity,
  deleteEdgesTouchingContact,
  repairGraphIntegrity,
  runGraphIntegrityJob,
} from "@/lib/db/graph-integrity";
import { db } from "@/lib/db/client";
import { contacts, embeddings, graphEdges, niches } from "@/lib/db/schema";
import { resetCoreTables } from "@/test/db";

describe("graph integrity", () => {
  beforeEach(() => {
    resetCoreTables();
  });

  it("detects edges with missing endpoints", () => {
    db.insert(graphEdges)
      .values({
        id: "orphan-edge",
        srcType: "contact",
        srcId: "missing-contact",
        dstType: "org",
        dstId: "missing-org",
        edgeType: "works_at",
        scope: "shared",
      })
      .run();

    const report = auditGraphIntegrity();
    expect(report.issueCount).toBe(1);
    expect(report.issues[0]?.reason).toBe("missing_endpoint");
  });

  it("repairs orphaned and archived-contact edges", () => {
    const alice = createContact({ name: "Alice", platform: "x", platformUserId: "a1" });
    const bob = createContact({ name: "Bob", platform: "x", platformUserId: "b1" });

    upsertGraphEdge({
      srcType: "contact",
      srcId: alice.id,
      dstType: "contact",
      dstId: bob.id,
      edgeType: "follows",
    });

    archiveContact(bob.id, "test prune");

    db.insert(graphEdges)
      .values({
        id: "bad-edge",
        srcType: "contact",
        srcId: "ghost",
        dstType: "contact",
        dstId: "also-ghost",
        edgeType: "relationship",
        scope: "local_only",
      })
      .run();

    const repaired = runGraphIntegrityJob({ repair: true });
    expect(repaired.repairedCount).toBe(1);
    expect(db.select().from(graphEdges).all()).toHaveLength(0);
  });

  it("deleteEdgesTouchingContact removes contact edges on archive path", () => {
    const alice = createContact({ name: "Alice", platform: "x", platformUserId: "a2" });
    const bob = createContact({ name: "Bob", platform: "x", platformUserId: "b2" });

    upsertGraphEdge({
      srcType: "contact",
      srcId: alice.id,
      dstType: "contact",
      dstId: bob.id,
      edgeType: "connected_to",
    });

    const removed = deleteEdgesTouchingContact(bob.id);
    expect(removed).toBe(1);
    expect(db.select().from(graphEdges).all()).toHaveLength(0);
  });

  it("repairGraphIntegrity is idempotent", () => {
    db.insert(graphEdges)
      .values({
        id: "solo-orphan",
        srcType: "contact",
        srcId: "nope",
        dstType: "contact",
        dstId: "nope2",
        edgeType: "follows",
        scope: "shared",
      })
      .run();

    const first = repairGraphIntegrity();
    const second = repairGraphIntegrity();

    expect(first.repairedCount).toBe(1);
    expect(second.repairedCount).toBe(0);
    expect(second.issueCount).toBe(0);
  });

  it("treats interaction endpoints as valid when the row exists", () => {
    const contact = createContact({ name: "Alice", platform: "x", platformUserId: "a3" });
    const interaction = logInteraction({
      contactId: contact.id,
      interactionType: "call",
      scope: "shared",
    });

    upsertGraphEdge({
      srcType: "contact",
      srcId: contact.id,
      dstType: "interaction",
      dstId: interaction.id,
      edgeType: "had_interaction",
    });

    const report = auditGraphIntegrity();
    expect(report.issueCount).toBe(0);
  });

  it("flags belongs_to_niche edges pointing at merged niches", () => {
    const contact = createContact({ name: "Niche Member", platform: "x", platformUserId: "nm1" });
    const nicheId = "merged-niche";
    db.insert(niches)
      .values({
        id: nicheId,
        name: "Old Cluster",
        slug: "old-cluster",
        status: "merged",
        scope: "shared",
      })
      .run();

    upsertGraphEdge({
      srcType: "contact",
      srcId: contact.id,
      dstType: "niche",
      dstId: nicheId,
      edgeType: "belongs_to_niche",
    });

    const report = auditGraphIntegrity();
    expect(report.issues.some((issue) => issue.reason === "stale_niche_membership")).toBe(true);
  });

  it("detects orphaned embeddings when the target node is missing", () => {
    db.insert(embeddings)
      .values({
        id: "orphan-embedding",
        nodeType: "contact",
        nodeId: "missing-contact",
        kind: "profile",
        model: "native:default",
        dims: 4,
        vector: Buffer.alloc(16),
        contentHash: "orphan",
        scope: "shared",
      })
      .run();

    const report = auditGraphIntegrity();
    expect(report.embeddingIssues).toHaveLength(1);
    expect(report.embeddingIssues[0]?.reason).toBe("missing_endpoint");
    expect(report.issueCount).toBe(1);
  });
});
