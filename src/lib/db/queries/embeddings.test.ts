import { beforeEach, describe, expect, it, vi } from "vitest";
import { nanoid } from "nanoid";
import { invokeAgentTool } from "@/lib/agent-tools/invoke";
import { createContact } from "@/lib/db/queries/contacts";
import { upsertEmbedding, semanticSearch } from "@/lib/db/queries/embeddings";
import { upsertNiche } from "@/lib/db/queries/niches";
import { embedNodeIfStale } from "@/lib/embeddings/embed-node";
import { float32ToBuffer } from "@/lib/embeddings/vector-utils";
import { db } from "@/lib/db/client";
import { embeddings } from "@/lib/db/schema";
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

describe("embeddings query layer", () => {
  beforeEach(() => {
    resetCoreTables();
    mockRtxEmbed.mockReset();
  });

  it("upsertEmbedding is a no-op when content hash is unchanged", () => {
    const contact = createContact({ name: "Ada", platform: "x", platformUserId: "ada-1" });
    const vector = float32ToBuffer(vectorWith(1));

    const first = upsertEmbedding({
      nodeType: "contact",
      nodeId: contact.id,
      kind: "profile",
      model: "native:default",
      vector,
      contentHash: "hash-1",
      dims: 4,
    });
    const second = upsertEmbedding({
      nodeType: "contact",
      nodeId: contact.id,
      kind: "profile",
      model: "native:default",
      vector,
      contentHash: "hash-1",
      dims: 4,
    });

    expect(first?.id).toBe(second?.id);
    expect(db.select().from(embeddings).all()).toHaveLength(1);
  });

  it("semanticSearch filters by model and skips mismatched dims", () => {
    const contactA = createContact({ name: "Alpha", platform: "x", platformUserId: "a" });
    const contactB = createContact({ name: "Beta", platform: "x", platformUserId: "b" });

    upsertEmbedding({
      nodeType: "contact",
      nodeId: contactA.id,
      kind: "profile",
      model: "native:default",
      vector: float32ToBuffer(vectorWith(1)),
      contentHash: "a",
      dims: 4,
    });
    upsertEmbedding({
      nodeType: "contact",
      nodeId: contactB.id,
      kind: "profile",
      model: "native:default",
      vector: float32ToBuffer(vectorWith(0.2, 8)),
      contentHash: "b",
      dims: 8,
    });

    const hits = semanticSearch({
      kind: "profile",
      model: "native:default",
      queryVector: vectorWith(1),
      k: 5,
    });

    expect(hits).toHaveLength(1);
    expect(hits[0]?.nodeId).toBe(contactA.id);
  });

  it("semanticSearch excludes local_only rows by default", () => {
    const shared = createContact({ name: "Shared", platform: "x", platformUserId: "shared" });
    const hidden = createContact({ name: "Hidden", platform: "x", platformUserId: "hidden" });

    upsertEmbedding({
      nodeType: "contact",
      nodeId: shared.id,
      kind: "profile",
      model: "native:default",
      vector: float32ToBuffer(vectorWith(1)),
      contentHash: "shared",
      dims: 4,
      scope: "shared",
    });
    upsertEmbedding({
      nodeType: "contact",
      nodeId: hidden.id,
      kind: "profile",
      model: "native:default",
      vector: float32ToBuffer(vectorWith(1)),
      contentHash: "hidden",
      dims: 4,
      scope: "local_only",
    });

    const publicHits = semanticSearch({
      kind: "profile",
      model: "native:default",
      queryVector: vectorWith(1),
      k: 10,
    });
    expect(publicHits).toHaveLength(1);
    expect(publicHits[0]?.nodeId).toBe(shared.id);

    const privateHits = semanticSearch({
      kind: "profile",
      model: "native:default",
      queryVector: vectorWith(1),
      k: 10,
      includeLocalOnly: true,
    });
    expect(privateHits).toHaveLength(2);
  });

  it("embedNodeIfStale skips unchanged text and embeds via RTX when stale", async () => {
    const niche = upsertNiche({ name: "AI Builders", description: "People shipping AI products" });
    mockRtxEmbed.mockResolvedValue({
      success: true,
      embeddings: [vectorWith(0.9)],
      provider: "native",
      model: "default",
      qualifiedModel: "native:default",
      dimensions: 4,
    });

    const first = await embedNodeIfStale("niche", niche.id, "description");
    expect(first.embedded).toBe(true);
    expect(mockRtxEmbed).toHaveBeenCalledTimes(1);

    const second = await embedNodeIfStale("niche", niche.id, "description");
    expect(second.skipped).toBe(true);
    expect(mockRtxEmbed).toHaveBeenCalledTimes(1);
  });

  it("semantic_search agent tool uses query embed model and returns labels", async () => {
    const niche = upsertNiche({ name: "Founders", description: "Startup founders" });
    upsertEmbedding({
      nodeType: "niche",
      nodeId: niche.id,
      kind: "description",
      model: "native:default",
      vector: float32ToBuffer(vectorWith(1)),
      contentHash: "founders",
      dims: 4,
    });

    mockRtxEmbed.mockResolvedValue({
      success: true,
      embeddings: [vectorWith(1)],
      provider: "native",
      model: "default",
      qualifiedModel: "native:default",
      dimensions: 4,
    });

    const result = await invokeAgentTool("semantic_search", {
      query: "startup founders",
      kind: "description",
      k: 5,
    });

    expect(result).toMatchObject({
      model: "native:default",
      kind: "description",
      resultCount: 1,
    });
    const row = (result as { results: { nodeId: string; label: string }[] }).results[0];
    expect(row?.nodeId).toBe(niche.id);
    expect(row?.label).toBe("Founders");
  });

  it("semantic_search surfaces RTX embed errors verbatim", async () => {
    mockRtxEmbed.mockResolvedValue({
      success: false,
      code: "PERMISSION_REQUIRED",
      error: "Approve llm.embed in RealtimeX Settings.",
    });

    await expect(
      invokeAgentTool("semantic_search", { query: "test query" }),
    ).rejects.toThrow("Approve llm.embed");
  });

  it(
    "semanticSearch scans 20k x 1536 vectors within ADR-022-4 latency budget",
    () => {
      const model = "bench:latency";
      const dims = 1536;
      const query = vectorWith(1, dims);
      const base = vectorWith(0.5, dims);

      db.transaction(() => {
        for (let i = 0; i < 20_000; i++) {
          db.insert(embeddings)
            .values({
              id: nanoid(),
              nodeType: "contact",
              nodeId: `bench-${i}`,
              kind: "profile",
              model,
              dims,
              vector: float32ToBuffer(base),
              contentHash: `bench-${i}`,
              scope: "shared",
            })
            .run();
        }
      });

      const durations: number[] = [];
      for (let run = 0; run < 5; run++) {
        const start = performance.now();
        const hits = semanticSearch({
          kind: "profile",
          model,
          queryVector: query,
          k: 10,
        });
        durations.push(performance.now() - start);
        expect(hits.length).toBeGreaterThan(0);
      }

      const elapsed = Math.min(...durations);
      // Design target is 250 ms (Amendment C); 500 ms min-of-5 leaves headroom for parallel CI.
      expect(elapsed).toBeLessThan(500);
    },
    30_000,
  );
});
