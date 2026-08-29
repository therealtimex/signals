import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { browserConnections, contentItems, contentPosts, graphEdges, launches, platformTargets, variants } from "@/lib/db/schema";
import { getLaunchById } from "@/lib/db/queries/launches";
import { createContentItem, deleteContentItem } from "@/lib/db/queries/content";
import { createPublishJob } from "@/lib/db/queries/publish-jobs";
import { invokeAgentTool } from "@/lib/agent-tools/invoke";
import { handleCompletePublish } from "@/lib/agent-tools/publish-handlers";
import { resetCoreTables } from "@/test/db";
import { buildWritingUnits } from "@/lib/writing/content-writing";
import { resolveWritingLineage } from "@/lib/writing/lineage";

function target() {
  db.insert(browserConnections).values({ id: "connection-1", sessionName: "writing-test", kind: "dedicated", status: "active" }).run();
  db.insert(platformTargets).values({ id: "target-1", connectionId: "connection-1", platform: "x", kind: "profile", name: "Writer", capabilities: "[]", status: "active" }).run();
  db.insert(platformTargets).values({ id: "target-linkedin", connectionId: "connection-1", platform: "linkedin", kind: "profile", name: "LinkedIn Writer", capabilities: "[]", status: "active" }).run();
  db.insert(platformTargets).values({ id: "target-facebook", connectionId: "connection-1", platform: "facebook", kind: "profile", name: "Facebook Writer", capabilities: "[]", status: "active" }).run();
}

async function launch(policy: "explicit" | "auto_low_risk" = "auto_low_risk") {
  const result = await invokeAgentTool("upsert_launch", {
    name: "Writing launch",
    metadata: { writing: {
      schemaVersion: 1,
      goal: "likes",
      surfaces: [{ platform: "x", surface: "x/post", targetId: "target-1" }],
      sources: [{ id: "src_source1", kind: "note", text: "Signals keeps claims grounded.", enteredAt: 10, sensitivity: { level: "public", reason: "public_default" } }],
      spine: {
        schemaVersion: 1, id: "spn_spine01", launchId: "placeholder", goal: "likes",
        audience: { nicheIds: [] },
        sources: [{ id: "src_source1", kind: "note", text: "Signals keeps claims grounded.", enteredAt: 10, sensitivity: { level: "public", reason: "public_default" } }],
        claims: [{ id: "clm_claim01", kind: "fact", text: "Signals keeps claims grounded.", sourceId: "src_source1", verbatimRequired: false, sensitivity: "public", includeInOutput: true }],
        message: { core: "Signals keeps claims grounded.", supporting: [], proofClaimIds: ["clm_claim01"] },
        extractedBy: { at: 10 }, hash: "incoming-is-replaced",
      },
      voiceProfile: null,
      voicePrecedence: "voice_first",
      approvalPolicy: policy,
      runs: [{ workflowRunId: "run-1", mode: "draft", startedAt: 10 }],
    } },
  }) as { id: string };
  return getLaunchById(result.id)!;
}

function audit(body: string, invented: string[] = [], limit = 280) {
  return {
    schemaVersion: 1,
    auditedAt: 20,
    auditor: { kind: "agent", skillVersion: "1" },
    overlay: { id: "overlay:x", version: 1 },
    core: { version: 1 },
    verdict: invented.length ? "block" : "pass",
    findings: [],
    claims: { total: 1, preserved: invented.length ? 0 : 1, altered: [], missing: [], invented: invented.map((text) => ({ text })), privateIncluded: [] },
    hard: { units: 1, chars: [body.length], limit, hashtags: 0, links: 0, mediaCount: 0 },
    voice: { status: "none", skipped: [] },
    heuristics: { applied: [], conflicts: [], skippedForVoice: [] },
  };
}

function voiceProfile(notes?: string) {
  return {
    schemaVersion: 1,
    id: "vp_context1",
    label: "Primary",
    ownerContactId: null,
    platforms: ["x"],
    samples: [0, 1, 2].map((index) => ({
      id: `vs_context${index}`,
      text: `My original context line ${index}`,
      source: { kind: "pasted", pastedAt: 30 + index },
      authorship: "self",
      approved: true,
    })),
    fingerprint: {
      sentenceLength: { medianWords: 4, range: [2, 8] },
      openers: [], closers: [], punctuation: [], vocabulary: { keep: [], avoid: [] },
      formats: [], emoji: "rare", hashtags: "none", protectedQuirks: [], taboo: [],
    },
    signatureLines: [{ text: "original context line", sampleId: "vs_context0" }],
    ...(notes ? { brand: { notes } } : {}),
    derivedBy: { method: "manual", at: 30 },
  };
}

function variantPayload(
  launchId: string,
  body = "Signals keeps claims grounded.",
  invented: string[] = [],
  surface: "x/post" | "linkedin/post" | "facebook/post" = "x/post",
  targetId = "target-1",
) {
  const launchRow = getLaunchById(launchId)!;
  const spine = JSON.parse(launchRow.metadata ?? "{}").writing.spine;
  const platform = surface.split("/")[0] as "x" | "linkedin" | "facebook";
  const limit = platform === "x" ? 280 : platform === "linkedin" ? 3_000 : 63_206;
  const writingAudit = audit(body, invented, limit);
  writingAudit.overlay = { id: `overlay:${platform}`, version: 1 };
  return {
    launchId,
    generationMetadata: { schemaVersion: 1, kind: "signals-writing", mode: "draft", model: "test-model", skill: { name: "signals-writing", version: "1" }, agent: { workflowRunId: "run-1" }, requestHash: `request-${surface}-${body}`, generatedAt: 20 },
    metadata: { writing: {
      schemaVersion: 1, platform, surface, targetId, goal: "likes",
      formulaId: `${surface}/test@1`, overlay: { id: `overlay:${platform}`, version: 1 }, core: { version: 1 },
      voiceProfile: null, voicePrecedence: "voice_first", spine: { id: spine.id, hash: spine.hash },
      units: buildWritingUnits([body]), claimMap: [{ claimId: "clm_claim01", present: !invented.length, unit: 0 }],
      audit: writingAudit, lineage: { sourceIds: ["src_source1"] },
    } },
  };
}

async function variant(
  launchId: string,
  body = "Signals keeps claims grounded.",
  invented: string[] = [],
  surface: "x/post" | "linkedin/post" | "facebook/post" = "x/post",
  targetId = "target-1",
) {
  return invokeAgentTool("upsert_variant", variantPayload(launchId, body, invented, surface, targetId)) as Promise<{ id: string; created: boolean; writing: boolean }>;
}

function mutableVariantPayload(...args: Parameters<typeof variantPayload>) {
  return structuredClone(variantPayload(...args)) as unknown as {
    id?: string;
    launchId: string;
    generationMetadata: Record<string, unknown>;
    metadata: { writing: Record<string, unknown> };
  };
}

function pointLaunchAtContentSource(launchId: string, contentItemId: string, scope: "shared" | "local_only" = "shared") {
  const row = getLaunchById(launchId)!;
  const metadata = JSON.parse(row.metadata ?? "{}");
  const source = {
    id: "src_source1",
    kind: "content_item",
    contentItemId,
    sha256: "source-snapshot-hash",
    contentType: "post",
    direction: "outbound",
    sensitivity: { level: "public", reason: "public_default" },
  };
  metadata.writing.sources = [source];
  metadata.writing.spine.sources = [source];
  metadata.writing.spine.claims[0].sourceId = source.id;
  db.update(launches).set({ scope, metadata: JSON.stringify(metadata) }).where(eq(launches.id, launchId)).run();
}

describe("writing lifecycle agent tools", () => {
  beforeEach(() => { resetCoreTables(); vi.restoreAllMocks(); target(); });

  it("materializes only after a current audit and is exactly idempotent", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    const launchRow = await launch();
    const saved = await variant(launchRow.id);
    expect(saved).toMatchObject({ created: true, writing: true });
    const first = await invokeAgentTool("materialize_variant", { variantId: saved.id }) as { contentItemId: string; created: boolean; updated: boolean };
    expect(first).toMatchObject({ created: true, updated: false });
    expect(db.select().from(contentItems).where(eq(contentItems.id, first.contentItemId)).get()).toMatchObject({ status: "approved", body: "Signals keeps claims grounded.", platformTarget: "x" });
    expect(await invokeAgentTool("materialize_variant", { variantId: saved.id })).toMatchObject({ contentItemId: first.contentItemId, created: false, updated: false });

    const row = db.select().from(variants).where(eq(variants.id, saved.id)).get()!;
    const metadata = JSON.parse(row.metadata ?? "{}");
    const revised = "Revised grounded copy.";
    metadata.writing.units = buildWritingUnits([revised]);
    metadata.writing.audit = audit(revised);
    metadata.writing.audit.auditedAt = 21;
    now.mockReturnValue(1_700_000_002_000);
    const update = await invokeAgentTool("upsert_variant", {
      id: saved.id,
      launchId: launchRow.id,
      metadata,
    }) as { created: boolean };
    expect(update.created).toBe(false);
    expect(JSON.parse(db.select().from(variants).where(eq(variants.id, saved.id)).get()!.metadata ?? "{}").writing.approval).toMatchObject({
      state: "revoked",
      by: "policy",
      at: 1_700_000_002,
      revokedReason: "audit_stale",
    });
    await expect(invokeAgentTool("materialize_variant", { variantId: saved.id })).rejects.toMatchObject({ code: "APPROVAL_REQUIRED" });
    const refreshed = await invokeAgentTool("materialize_variant", {
      variantId: saved.id,
      approval: { by: "user", evidence: { kind: "api", caller: "test" } },
    }) as { contentItemId: string; updated: boolean };
    expect(refreshed).toMatchObject({ contentItemId: first.contentItemId, updated: true });
    expect(db.select().from(contentItems).where(eq(contentItems.id, first.contentItemId)).get()?.body).toBe(revised);
  });

  it("coalesces create retries by launch requestHash", async () => {
    const launchRow = await launch();
    const first = await variant(launchRow.id);
    const retry = await variant(launchRow.id);
    expect(retry).toMatchObject({ id: first.id, created: false });
    expect(db.select().from(variants).where(eq(variants.launchId, launchRow.id)).all()).toHaveLength(1);
  });

  it("persists independent platform variants against one immutable spine", async () => {
    const launchRow = await launch();
    await invokeAgentTool("upsert_launch", {
      id: launchRow.id,
      name: launchRow.name,
      metadata: { writing: { surfaces: [
        { platform: "x", surface: "x/post", targetId: "target-1" },
        { platform: "linkedin", surface: "linkedin/post", targetId: "target-linkedin" },
        { platform: "facebook", surface: "facebook/post", targetId: "target-facebook" },
      ] } },
    });

    const saved = await Promise.all([
      variant(launchRow.id, "Short X observation.", [], "x/post", "target-1"),
      variant(launchRow.id, "A reflective LinkedIn lesson with its own structure.", [], "linkedin/post", "target-linkedin"),
      variant(launchRow.id, "A conversational Facebook update for the community.", [], "facebook/post", "target-facebook"),
    ]);
    const rows = saved.map((entry) => db.select().from(variants).where(eq(variants.id, entry.id)).get()!);
    const writings = rows.map((row) => JSON.parse(row.metadata ?? "{}").writing);

    expect(writings.map((writing) => `${writing.platform}/${writing.surface}`)).toEqual([
      "x/x/post",
      "linkedin/linkedin/post",
      "facebook/facebook/post",
    ]);
    expect(new Set(writings.map((writing) => writing.spine.hash)).size).toBe(1);
    expect(new Set(rows.map((row) => row.body)).size).toBe(3);
    expect(getLaunchById(launchRow.id)?.status).toBe("ready");
  });

  it.each(["queued", "publishing", "published", "scheduled"] as const)(
    "locks a variant before mutation when its content item is %s",
    async (laneStatus) => {
      const launchRow = await launch();
      const saved = await variant(launchRow.id);
      const materialized = await invokeAgentTool("materialize_variant", { variantId: saved.id }) as { contentItemId: string };
      db.update(contentItems).set({ status: laneStatus }).where(eq(contentItems.id, materialized.contentItemId)).run();
      const before = db.select().from(variants).where(eq(variants.id, saved.id)).get()!;
      const payload = mutableVariantPayload(launchRow.id, `Revised while ${laneStatus}`);
      payload.id = saved.id;

      await expect(invokeAgentTool("upsert_variant", payload)).rejects.toMatchObject({
        code: "CONFLICT",
        details: { reason: "variant_locked", contentItemId: materialized.contentItemId, status: laneStatus },
      });
      expect(db.select().from(variants).where(eq(variants.id, saved.id)).get()).toEqual(before);
    },
  );

  it("blocks invented claims and stale audit input", async () => {
    const launchRow = await launch();
    const blocked = await variant(launchRow.id, "An invented claim", ["Invented"]);
    await expect(invokeAgentTool("materialize_variant", { variantId: blocked.id })).rejects.toMatchObject({ code: "AUDIT_BLOCKED" });
    const current = await variant(launchRow.id, "Current copy");
    db.update(variants).set({ body: "tampered" }).where(eq(variants.id, current.id)).run();
    await expect(invokeAgentTool("materialize_variant", { variantId: current.id })).rejects.toMatchObject({ code: "AUDIT_STALE" });
  });

  it("requires explicit evidence and revokes unqueued materialization on spine change", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    const launchRow = await launch("explicit");
    const saved = await variant(launchRow.id);
    await expect(invokeAgentTool("materialize_variant", { variantId: saved.id })).rejects.toMatchObject({ code: "APPROVAL_REQUIRED" });
    const approval = { by: "user" as const, evidence: { kind: "api" as const, caller: "test" } };
    const materialized = await invokeAgentTool("materialize_variant", { variantId: saved.id, approval }) as { contentItemId: string };
    now.mockReturnValue(1_700_000_002_000);
    expect(await invokeAgentTool("materialize_variant", { variantId: saved.id, approval })).toMatchObject({
      contentItemId: materialized.contentItemId,
      created: false,
      updated: false,
    });
    now.mockReturnValue(1_700_000_004_000);
    await invokeAgentTool("upsert_launch", {
      id: launchRow.id,
      name: launchRow.name,
      metadata: { writing: { spine: { message: { core: "A changed supported message." } } } },
    });
    expect(db.select().from(contentItems).where(eq(contentItems.id, materialized.contentItemId)).get()?.status).toBe("draft");
    expect(JSON.parse(db.select().from(variants).where(eq(variants.id, saved.id)).get()!.metadata ?? "{}").writing.approval).toMatchObject({
      state: "revoked",
      by: "user",
      at: 1_700_000_004,
      revokedReason: "spine_changed",
    });
  });

  it("owns materialized lineage and rejects agent-forged edges", async () => {
    const launchRow = await launch();
    const saved = await variant(launchRow.id);
    await invokeAgentTool("materialize_variant", { variantId: saved.id });
    expect(db.select().from(graphEdges).where(eq(graphEdges.edgeType, "materialized_as")).all()).toHaveLength(1);
    await expect(invokeAgentTool("upsert_edge", { srcType: "variant", srcId: saved.id, dstType: "launch", dstId: launchRow.id, edgeType: "derived_from" })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(resolveWritingLineage({ variantId: saved.id })).toMatchObject({
      variant: { id: saved.id },
      launch: { id: launchRow.id },
      sources: [{ id: "src_source1", kind: "note" }],
      edges: [{ edgeType: "materialized_as" }],
      materialization: { edgeType: "materialized_as" },
    });
  });

  it("keeps local-only writing lineage edges hidden unless explicitly requested", async () => {
    const source = createContentItem({
      body: "Local-only source evidence",
      contentType: "post",
      status: "draft",
      origin: "authored",
      direction: "outbound",
    });
    const launchRow = await launch();
    pointLaunchAtContentSource(launchRow.id, source.id, "local_only");
    const saved = await variant(launchRow.id);

    expect(await invokeAgentTool("query_graph", {
      nodeType: "variant",
      nodeId: saved.id,
      edgeTypes: ["sourced_from"],
    })).toMatchObject({ edgeCount: 0, edges: [] });
    expect(await invokeAgentTool("query_graph", {
      nodeType: "variant",
      nodeId: saved.id,
      edgeTypes: ["sourced_from"],
      includeLocalOnly: true,
    })).toMatchObject({
      edgeCount: 1,
      edges: [{ edgeType: "sourced_from", dstId: source.id, scope: "local_only" }],
    });
  });

  it("resolves source-to-publish-outcome lineage after complete_publish", async () => {
    const source = createContentItem({
      body: "Published source evidence",
      contentType: "post",
      status: "draft",
      origin: "authored",
      direction: "outbound",
    });
    const launchRow = await launch();
    pointLaunchAtContentSource(launchRow.id, source.id);
    const saved = await variant(launchRow.id);
    const materialized = await invokeAgentTool("materialize_variant", { variantId: saved.id }) as { contentItemId: string };
    const job = createPublishJob({
      contentItemId: materialized.contentItemId,
      payload: {
        text: "Signals keeps claims grounded.",
        mediaAssetIds: [],
        platforms: ["x"],
        composedAt: 30,
      },
      platforms: ["x"],
      targets: [{ platform: "x", targetId: "target-1", expectedHandle: "@writer", status: "pending" }],
    });
    db.update(contentItems).set({ status: "queued" }).where(eq(contentItems.id, materialized.contentItemId)).run();

    await handleCompletePublish({
      jobId: job.id,
      platform: "x",
      targetId: "target-1",
      success: true,
      handle: "@writer",
      platformPostId: "writing-lineage-post",
      platformUrl: "https://x.com/writer/status/writing-lineage-post",
    });
    const post = db.select().from(contentPosts).where(eq(contentPosts.contentItemId, materialized.contentItemId)).get()!;
    const lineage = resolveWritingLineage({ contentPostId: post.id });

    expect(db.select().from(variants).where(eq(variants.id, saved.id)).get()?.status).toBe("published");
    expect(lineage).toMatchObject({
      post: { id: post.id, contentItemId: materialized.contentItemId },
      contentItem: { id: materialized.contentItemId, status: "published" },
      variant: { id: saved.id, launchId: launchRow.id, status: "published" },
      launch: { id: launchRow.id, status: "live" },
      sources: [{ id: "src_source1", kind: "content_item", contentItemId: source.id }],
      published: { targetId: "target-1", publishedAt: expect.any(Number) },
    });
    expect(lineage.edges.map((edge) => edge.edgeType)).toEqual(expect.arrayContaining([
      "sourced_from",
      "materialized_as",
      "published_as",
    ]));
  });

  it("adopts an existing draft for the variant and completes both anchors", async () => {
    const launchRow = await launch();
    const saved = await variant(launchRow.id);
    const draft = createContentItem({
      body: "Pre-materialization draft",
      contentType: "post",
      platformTarget: "x",
      status: "draft",
      aiGenerated: true,
      origin: "authored",
      direction: "outbound",
      platformData: JSON.stringify({
        writing: {
          schemaVersion: 1,
          capability: { publish: "direct" },
          units: buildWritingUnits(["Pre-materialization draft"]),
          origin: { launchId: launchRow.id, variantId: saved.id },
        },
      }),
    });

    const materialized = await invokeAgentTool("materialize_variant", { variantId: saved.id }) as {
      contentItemId: string;
      adopted: boolean;
      created: boolean;
      updated: boolean;
    };
    expect(materialized).toMatchObject({
      contentItemId: draft.id,
      adopted: true,
      created: false,
      updated: true,
    });
    expect(db.select().from(variants).where(eq(variants.id, saved.id)).get()?.contentItemId).toBe(draft.id);
    expect(db.select().from(graphEdges).where(eq(graphEdges.edgeType, "materialized_as")).get()).toMatchObject({
      srcId: saved.id,
      dstId: draft.id,
    });
  });

  it("validates before returning an existing materialization", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    const launchRow = await launch();
    const saved = await variant(launchRow.id);
    await invokeAgentTool("materialize_variant", { variantId: saved.id });
    now.mockReturnValue(1_700_000_002_000);
    expect(await invokeAgentTool("revoke_variant_approval", { variantId: saved.id, reason: "user" })).toMatchObject({
      variantId: saved.id,
      approval: {
        state: "revoked",
        by: "user",
        at: 1_700_000_002,
        revokedReason: "user",
      },
    });
    await expect(invokeAgentTool("materialize_variant", { variantId: saved.id })).rejects.toMatchObject({
      code: "APPROVAL_REQUIRED",
    });
  });

  it("returns the current spine, active voice, and stored lifecycle projection", async () => {
    const first = await invokeAgentTool("upsert_voice_profile", { profile: voiceProfile() }) as {
      profile: { id: string; version: number; hash: string };
    };
    await invokeAgentTool("approve_voice_profile", {
      id: first.profile.id,
      version: first.profile.version,
      evidence: { kind: "api", caller: "test" },
    });
    const launchRow = await launch();
    const saved = await variant(launchRow.id);
    const materialized = await invokeAgentTool("materialize_variant", { variantId: saved.id }) as { contentItemId: string };
    const context = await invokeAgentTool("get_writing_context", { launchId: launchRow.id }) as Record<string, unknown>;

    expect(context).toMatchObject({
      launch: {
        status: "ready",
        writing: {
          voiceProfile: null,
          spine: {
            id: "spn_spine01",
            message: { core: "Signals keeps claims grounded." },
            claims: [{ id: "clm_claim01", text: "Signals keeps claims grounded." }],
          },
        },
      },
      voiceProfile: { id: first.profile.id, version: 1, status: "approved" },
      voice: { status: "active" },
      variants: [{
        id: saved.id,
        materializedContentItemId: materialized.contentItemId,
        contentItemStatus: "approved",
        riskTier: "low",
        auditStale: false,
        lineage: { sourceIds: ["src_source1"] },
      }],
    });

    await invokeAgentTool("upsert_launch", {
      id: launchRow.id,
      name: launchRow.name,
      metadata: { writing: { voiceProfile: first.profile } },
    });
    const second = await invokeAgentTool("upsert_voice_profile", { profile: voiceProfile("revision") }) as {
      profile: { id: string; version: number; hash: string };
    };
    await invokeAgentTool("approve_voice_profile", {
      id: second.profile.id,
      version: second.profile.version,
      evidence: { kind: "api", caller: "test" },
    });
    expect(await invokeAgentTool("get_writing_context", { launchId: launchRow.id })).toMatchObject({
      voiceProfile: { id: first.profile.id, version: 1, status: "superseded" },
      voice: { status: "pinned_superseded", activeVersion: 2 },
    });
  });

  it("redacts private claims from the spine's own divergent source snapshot", async () => {
    const launchRow = await launch();
    const metadata = JSON.parse(launchRow.metadata ?? "{}");
    metadata.writing.sources = [];
    metadata.writing.spine.sources = [{
      id: "src_private1",
      kind: "note",
      text: "PRIVATE_SENTINEL",
      enteredAt: 10,
      sensitivity: { level: "private", reason: "user_marked" },
    }];
    metadata.writing.spine.claims = [{
      id: "clm_private1",
      kind: "fact",
      text: "PRIVATE_SENTINEL",
      sourceId: "src_private1",
      verbatimRequired: false,
      sensitivity: "private",
      includeInOutput: false,
    }];
    db.update(launches).set({ metadata: JSON.stringify(metadata) }).where(eq(launches.id, launchRow.id)).run();

    const context = await invokeAgentTool("get_writing_context", {
      launchId: launchRow.id,
      includeSources: true,
    });
    expect(JSON.stringify(context)).not.toContain("PRIVATE_SENTINEL");
    expect(context).toMatchObject({
      sources: [],
      launch: { writing: { sources: [], spine: {
        sources: [{ id: "src_private1", redacted: true }],
        claims: [{ id: "clm_private1", text: null, redacted: true }],
      } } },
    });
  });

  it("rejects a forged passing verdict for invented claims", async () => {
    const launchRow = await launch();
    const launchMeta = JSON.parse(launchRow.metadata ?? "{}");
    const body = "An invented claim";
    const writingAudit = audit(body, ["Invented"]);
    writingAudit.verdict = "pass";
    await expect(invokeAgentTool("upsert_variant", {
      launchId: launchRow.id,
      generationMetadata: { schemaVersion: 1, kind: "signals-writing", mode: "draft", model: "test-model", skill: { name: "signals-writing", version: "1" }, agent: { workflowRunId: "run-1" }, requestHash: "forged-verdict", generatedAt: 20 },
      metadata: { writing: {
        schemaVersion: 1, platform: "x", surface: "x/post", targetId: "target-1", goal: "likes",
        formulaId: "x/post/test@1", overlay: { id: "overlay:x", version: 1 }, core: { version: 1 },
        voiceProfile: null, voicePrecedence: "voice_first", spine: { id: launchMeta.writing.spine.id, hash: launchMeta.writing.spine.hash },
        units: buildWritingUnits([body]), claimMap: [], audit: writingAudit, lineage: { sourceIds: [] },
      } },
    })).rejects.toMatchObject({ code: "VALIDATION_ERROR", details: { reason: "audit_verdict_mismatch" } });
  });

  it.each(["hard", "claim"] as const)(
    "rejects a %s blocker that is falsely marked voice-skipped",
    async (findingClass) => {
      const launchRow = await launch();
      const payload = mutableVariantPayload(launchRow.id, `Blocked ${findingClass}-rule copy`);
      const writingAudit = payload.metadata.writing.audit as Record<string, unknown>;
      writingAudit.findings = [{
        code: `x/post/${findingClass}/blocked-test`,
        class: findingClass,
        severity: "blocker",
        message: "A blocker cannot be skipped for voice.",
        skippedForVoice: true,
      }];
      writingAudit.verdict = "pass";

      await expect(invokeAgentTool("upsert_variant", payload)).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
        details: { reason: "audit_voice_skip_class" },
      });
      expect(db.select().from(variants).where(eq(variants.launchId, launchRow.id)).all()).toHaveLength(0);
    },
  );

  it.each(["missing", "altered"] as const)(
    "derives warn for %s claims and prevents auto-low-risk materialization",
    async (claimOutcome) => {
      const launchRow = await launch();
      const payload = mutableVariantPayload(launchRow.id, `${claimOutcome} grounded claim`);
      const writing = payload.metadata.writing;
      const writingAudit = writing.audit as Record<string, unknown>;
      const claims = writingAudit.claims as Record<string, unknown>;
      claims.preserved = 0;
      claims[claimOutcome] = ["clm_claim01"];
      writingAudit.verdict = "warn";
      writing.claimMap = [{ claimId: "clm_claim01", present: claimOutcome === "altered", unit: 0, verbatim: false }];

      const saved = await invokeAgentTool("upsert_variant", payload) as { id: string };
      const persisted = JSON.parse(db.select().from(variants).where(eq(variants.id, saved.id)).get()!.metadata ?? "{}").writing;
      expect(persisted).toMatchObject({
        audit: { verdict: "warn" },
        approval: { state: "pending", riskTier: "medium" },
      });
      await expect(invokeAgentTool("materialize_variant", { variantId: saved.id })).rejects.toMatchObject({
        code: "APPROVAL_REQUIRED",
      });
    },
  );

  it("unlinks an unqueued materialization on delete and refuses publish-lane deletion", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    const launchRow = await launch();
    const saved = await variant(launchRow.id);
    const first = await invokeAgentTool("materialize_variant", { variantId: saved.id }) as { contentItemId: string };
    now.mockReturnValue(1_700_000_002_000);
    expect(deleteContentItem(first.contentItemId)).toBe(true);
    expect(db.select().from(variants).where(eq(variants.id, saved.id)).get()).toMatchObject({ contentItemId: null, status: "draft" });
    expect(JSON.parse(db.select().from(variants).where(eq(variants.id, saved.id)).get()!.metadata ?? "{}").writing.approval).toMatchObject({
      state: "revoked",
      by: "user",
      at: 1_700_000_002,
      revokedReason: "user",
    });
    expect(db.select().from(graphEdges).where(eq(graphEdges.edgeType, "materialized_as")).all()).toHaveLength(0);

    const secondVariant = await variant(launchRow.id, "Another grounded variant.");
    const second = await invokeAgentTool("materialize_variant", { variantId: secondVariant.id }) as { contentItemId: string };
    db.update(contentItems).set({ status: "queued" }).where(eq(contentItems.id, second.contentItemId)).run();
    expect(() => deleteContentItem(second.contentItemId)).toThrow(/publish lane/i);
  });
});
