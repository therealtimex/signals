import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createContact } from "@/lib/db/queries/contacts";
import { createContactEmployment } from "@/lib/db/queries/contact-employments";
import { createOrg } from "@/lib/db/queries/orgs";
import {
  contactNeedsProfileReembed,
  ensureContactProfileEmbedSweepJob,
  getPendingContactProfileEmbedSweepJobId,
  isContactProfileEmbedSweepComplete,
  listContactsNeedingProfileReembed,
  resetContactProfileEmbedSweepStateForTests,
  runContactProfileEmbedSweep,
  runContactProfileEmbedSweepUntilCaughtUp,
} from "@/lib/db/contact-profile-embed-sweep";
import { semanticSearch, upsertEmbedding } from "@/lib/db/queries/embeddings";
import { float32ToBuffer } from "@/lib/embeddings/vector-utils";
import { db } from "@/lib/db/client";
import { contacts, embeddings } from "@/lib/db/schema";
import { resetCoreTables } from "@/test/db";

const mockRtxEmbed = vi.fn();

vi.mock("@/lib/rtx/llm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/rtx/llm")>();
  return {
    ...actual,
    rtxEmbed: (...args: Parameters<typeof actual.rtxEmbed>) => mockRtxEmbed(...args),
  };
});

function vectorWith(value: number, dims = 4): Float32Array {
  const vector = new Float32Array(dims);
  vector[0] = value;
  return vector;
}

describe("contact profile embed sweep", () => {
  beforeEach(() => {
    resetCoreTables();
    resetContactProfileEmbedSweepStateForTests();
    mockRtxEmbed.mockReset();
  });

  it("flags contacts with stale profile embeddings after employment-backed text changes", () => {
    const contact = createContact({ name: "Stale", platform: "x", platformUserId: "stale-1" });
    upsertEmbedding({
      nodeType: "contact",
      nodeId: contact.id,
      kind: "profile",
      model: "native:default",
      vector: float32ToBuffer(vectorWith(1)),
      contentHash: "old-hash",
      dims: 4,
    });

    expect(contactNeedsProfileReembed(contact.id)).toBe(true);
    expect(listContactsNeedingProfileReembed()).toContain(contact.id);
  });

  it("regenerates profile embeddings and keeps semantic search candidates", async () => {
    const contact = createContact({ name: "Ada", platform: "x", platformUserId: "sweep-1" });
    const org = createOrg({ name: "Structured Corp", source: "test" });
    createContactEmployment({
      contactId: contact.id,
      orgId: org.id,
      title: "VP Sales",
      isCurrent: true,
      source: "test",
    });
    upsertEmbedding({
      nodeType: "contact",
      nodeId: contact.id,
      kind: "profile",
      model: "native:default",
      vector: float32ToBuffer(vectorWith(0.1)),
      contentHash: "old-hash",
      dims: 4,
    });

    mockRtxEmbed.mockResolvedValue({
      success: true,
      embeddings: [vectorWith(0.9)],
      provider: "native",
      model: "default",
      qualifiedModel: "native:default",
      dimensions: 4,
    });

    const report = await runContactProfileEmbedSweep({ batchSize: 10 });
    expect(report.embedded).toBe(1);
    expect(report.complete).toBe(true);
    expect(isContactProfileEmbedSweepComplete()).toBe(true);
    expect(contactNeedsProfileReembed(contact.id)).toBe(false);

    const hits = semanticSearch({
      kind: "profile",
      model: "native:default",
      queryVector: vectorWith(0.9),
      nodeTypes: ["contact"],
      k: 5,
    });
    expect(hits.some((hit) => hit.nodeId === contact.id)).toBe(true);

    const row = db
      .select()
      .from(embeddings)
      .where(eq(embeddings.nodeId, contact.id))
      .get();
    expect(row?.contentHash).not.toBe("old-hash");
  });

  it("schedules continuation when a single batch cannot finish", async () => {
    mockRtxEmbed.mockResolvedValue({
      success: true,
      embeddings: [vectorWith(0.9)],
      provider: "native",
      model: "default",
      qualifiedModel: "native:default",
      dimensions: 4,
    });

    for (let i = 0; i < 26; i++) {
      const contact = createContact({
        name: `Batch ${i}`,
        platform: "x",
        platformUserId: `batch-${i}`,
      });
      upsertEmbedding({
        nodeType: "contact",
        nodeId: contact.id,
        kind: "profile",
        model: "native:default",
        vector: float32ToBuffer(vectorWith(0.1)),
        contentHash: "old-hash",
        dims: 4,
      });
    }

    const firstBatch = await runContactProfileEmbedSweep({ batchSize: 25 });
    expect(firstBatch.processed).toBe(25);
    expect(firstBatch.remaining).toBe(1);
    expect(firstBatch.complete).toBe(false);
    expect(getPendingContactProfileEmbedSweepJobId()).not.toBeNull();

    const final = await runContactProfileEmbedSweepUntilCaughtUp({ batchSize: 25 });
    expect(final.complete).toBe(true);
    expect(isContactProfileEmbedSweepComplete()).toBe(true);
    expect(listContactsNeedingProfileReembed()).toHaveLength(0);

    const hits = semanticSearch({
      kind: "profile",
      model: "native:default",
      queryVector: vectorWith(0.9),
      nodeTypes: ["contact"],
      k: 30,
    });
    expect(hits).toHaveLength(26);
  });

  it("enqueues only one pending continuation job", () => {
    for (let i = 0; i < 3; i++) {
      createContact({ name: `Pending ${i}`, platform: "x", platformUserId: `pending-${i}` });
    }

    expect(ensureContactProfileEmbedSweepJob()).toBe(true);
    expect(ensureContactProfileEmbedSweepJob()).toBe(false);
    expect(getPendingContactProfileEmbedSweepJobId()).not.toBeNull();
  });
});
