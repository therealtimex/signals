import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { invokeAgentTool } from "@/lib/agent-tools/invoke";
import { createContact, deleteContact } from "@/lib/db/queries/contacts";
import { upsertEmbedding, semanticSearch, assembleEmbedText } from "@/lib/db/queries/embeddings";
import { upsertNiche } from "@/lib/db/queries/niches";
import { createContactEmployment } from "@/lib/db/queries/contact-employments";
import { createOrg } from "@/lib/db/queries/orgs";
import { embedNodeIfStale } from "@/lib/embeddings/embed-node";
import { bufferToFloat32, float32ToBuffer } from "@/lib/embeddings/vector-utils";
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

function axisVector(axis: number, dims = 4): Float32Array {
  const vector = new Float32Array(dims);
  vector[axis] = 1;
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

  it("semanticSearch excludes orphan contact embeddings before integrity repair", () => {
    const contact = createContact({ name: "Gone", platform: "x", platformUserId: "gone-1" });
    upsertEmbedding({
      nodeType: "contact",
      nodeId: contact.id,
      kind: "profile",
      model: "native:default",
      vector: float32ToBuffer(vectorWith(1)),
      contentHash: "gone",
      dims: 4,
    });

    deleteContact(contact.id);

    const hits = semanticSearch({
      kind: "profile",
      model: "native:default",
      queryVector: vectorWith(1),
      k: 5,
      nodeTypes: ["contact"],
    });

    expect(hits).toHaveLength(0);
  });

  it("semanticSearch deduplicates repeated nodeTypes", () => {
    const contact = createContact({ name: "Once", platform: "x", platformUserId: "once" });
    upsertEmbedding({
      nodeType: "contact",
      nodeId: contact.id,
      kind: "profile",
      model: "native:default",
      vector: float32ToBuffer(vectorWith(1)),
      contentHash: "once",
      dims: 4,
    });

    const hits = semanticSearch({
      kind: "profile",
      model: "native:default",
      queryVector: vectorWith(1),
      k: 5,
      nodeTypes: ["contact", "contact"],
    });

    expect(hits).toHaveLength(1);
    expect(hits[0]?.nodeId).toBe(contact.id);
  });

  it("semanticSearch excludes local_only embedding rows by default", () => {
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

  it("semanticSearch hides stale shared embeddings when source scope becomes local_only", () => {
    const niche = upsertNiche({ name: "Public Niche", description: "Visible cluster" });
    upsertEmbedding({
      nodeType: "niche",
      nodeId: niche.id,
      kind: "description",
      model: "native:default",
      vector: float32ToBuffer(vectorWith(1)),
      contentHash: "niche",
      dims: 4,
      scope: "shared",
    });

    upsertNiche({ id: niche.id, name: "Public Niche", scope: "local_only" });

    const hits = semanticSearch({
      kind: "description",
      model: "native:default",
      queryVector: vectorWith(1),
      k: 10,
    });
    expect(hits).toHaveLength(0);
  });

  it("embedNodeIfStale force replaces vector when content hash is unchanged", async () => {
    const contact = createContact({ name: "Force", platform: "x", platformUserId: "force-1" });
    mockRtxEmbed
      .mockResolvedValueOnce({
        success: true,
        embeddings: [axisVector(0)],
        provider: "native",
        model: "default",
        qualifiedModel: "native:default",
        dimensions: 4,
      })
      .mockResolvedValueOnce({
        success: true,
        embeddings: [axisVector(1)],
        provider: "native",
        model: "default",
        qualifiedModel: "native:default",
        dimensions: 4,
      });

    await embedNodeIfStale("contact", contact.id, "profile");
    await embedNodeIfStale("contact", contact.id, "profile", { force: true });

    const stored = bufferToFloat32(
      db.select().from(embeddings).where(eq(embeddings.nodeId, contact.id)).get()!.vector,
    );
    expect(stored[1]).toBe(1);
    expect(stored[0]).toBe(0);
  });

  it("rejects embedding variant body when parent launch is local_only", async () => {
    const launch = await invokeAgentTool("upsert_launch", {
      name: "Private Launch",
      scope: "local_only",
    });
    const variant = await invokeAgentTool("upsert_variant", {
      launchId: (launch as { id: string }).id,
      body: "secret copy",
    });

    await expect(
      embedNodeIfStale("variant", (variant as { id: string }).id, "body"),
    ).rejects.toThrow("local_only");
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

  it("semantic_search omits nodes that became local_only even with stale shared embeddings", async () => {
    const niche = upsertNiche({ name: "Stealth Cluster", description: "Was public" });
    upsertEmbedding({
      nodeType: "niche",
      nodeId: niche.id,
      kind: "description",
      model: "native:default",
      vector: float32ToBuffer(vectorWith(1)),
      contentHash: "stealth",
      dims: 4,
      scope: "shared",
    });
    upsertNiche({ id: niche.id, name: "Stealth Cluster", scope: "local_only" });

    mockRtxEmbed.mockResolvedValue({
      success: true,
      embeddings: [vectorWith(1)],
      provider: "native",
      model: "default",
      qualifiedModel: "native:default",
      dimensions: 4,
    });

    const result = await invokeAgentTool("semantic_search", {
      query: "stealth cluster",
      kind: "description",
      k: 5,
    });

    expect(result).toMatchObject({ resultCount: 0, results: [] });
  });

  it("builds contact profile embed text from employments instead of scalar columns", () => {
    const contact = createContact({ name: "Ada", platform: "x", platformUserId: "embed-career" });
    const org = createOrg({ name: "Structured Corp", source: "test" });
    createContactEmployment({
      contactId: contact.id,
      orgId: org.id,
      title: "VP Sales",
      isCurrent: true,
      source: "test",
    });
    db.update(contacts)
      .set({ company: "Stale Scalar Co", title: "Stale Title" })
      .where(eq(contacts.id, contact.id))
      .run();

    const text = assembleEmbedText("contact", contact.id, "profile");
    expect(text).toContain("Structured Corp");
    expect(text).toContain("VP Sales");
    expect(text).not.toContain("Stale Scalar Co");
    expect(text).not.toContain("Stale Title");
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
});
