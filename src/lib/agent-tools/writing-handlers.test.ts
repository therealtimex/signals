import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { browserConnections, contentItems, graphEdges, platformTargets, variants } from "@/lib/db/schema";
import { getLaunchById } from "@/lib/db/queries/launches";
import { createContentItem, deleteContentItem } from "@/lib/db/queries/content";
import { invokeAgentTool } from "@/lib/agent-tools/invoke";
import { resetCoreTables } from "@/test/db";
import { buildWritingUnits } from "@/lib/writing/content-writing";
import { resolveWritingLineage } from "@/lib/writing/lineage";

function target() {
  db.insert(browserConnections).values({ id: "connection-1", sessionName: "writing-test", kind: "dedicated", status: "active" }).run();
  db.insert(platformTargets).values({ id: "target-1", connectionId: "connection-1", platform: "x", kind: "profile", name: "Writer", capabilities: "[]", status: "active" }).run();
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

function audit(body: string, invented: string[] = []) {
  return {
    schemaVersion: 1,
    auditedAt: 20,
    auditor: { kind: "agent", skillVersion: "1" },
    overlay: { id: "overlay:x", version: 1 },
    core: { version: 1 },
    verdict: invented.length ? "block" : "pass",
    findings: [],
    claims: { total: 1, preserved: invented.length ? 0 : 1, altered: [], missing: [], invented: invented.map((text) => ({ text })), privateIncluded: [] },
    hard: { units: 1, chars: [body.length], limit: 280, hashtags: 0, links: 0, mediaCount: 0 },
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

async function variant(launchId: string, body = "Signals keeps claims grounded.", invented: string[] = []) {
  const launchRow = getLaunchById(launchId)!;
  const spine = JSON.parse(launchRow.metadata ?? "{}").writing.spine;
  return invokeAgentTool("upsert_variant", {
    launchId,
    generationMetadata: { schemaVersion: 1, kind: "signals-writing", mode: "draft", model: "test-model", skill: { name: "signals-writing", version: "1" }, agent: { workflowRunId: "run-1" }, requestHash: `request-${body}`, generatedAt: 20 },
    metadata: { writing: {
      schemaVersion: 1, platform: "x", surface: "x/post", targetId: "target-1", goal: "likes",
      formulaId: "x/post/test@1", overlay: { id: "overlay:x", version: 1 }, core: { version: 1 },
      voiceProfile: null, voicePrecedence: "voice_first", spine: { id: spine.id, hash: spine.hash },
      units: buildWritingUnits([body]), claimMap: [{ claimId: "clm_claim01", present: !invented.length, unit: 0 }],
      audit: audit(body, invented), lineage: { sourceIds: ["src_source1"] },
    } },
  }) as Promise<{ id: string; created: boolean; writing: boolean }>;
}

describe("writing lifecycle agent tools", () => {
  beforeEach(() => { resetCoreTables(); target(); });

  it("materializes only after a current audit and is exactly idempotent", async () => {
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
    const update = await invokeAgentTool("upsert_variant", {
      id: saved.id,
      launchId: launchRow.id,
      metadata,
    }) as { created: boolean };
    expect(update.created).toBe(false);
    expect(JSON.parse(db.select().from(variants).where(eq(variants.id, saved.id)).get()!.metadata ?? "{}").writing.approval).toMatchObject({
      state: "revoked",
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

  it("blocks invented claims and stale audit input", async () => {
    const launchRow = await launch();
    const blocked = await variant(launchRow.id, "An invented claim", ["Invented"]);
    await expect(invokeAgentTool("materialize_variant", { variantId: blocked.id })).rejects.toMatchObject({ code: "AUDIT_BLOCKED" });
    const current = await variant(launchRow.id, "Current copy");
    db.update(variants).set({ body: "tampered" }).where(eq(variants.id, current.id)).run();
    await expect(invokeAgentTool("materialize_variant", { variantId: current.id })).rejects.toMatchObject({ code: "AUDIT_STALE" });
  });

  it("requires explicit evidence and revokes unqueued materialization on spine change", async () => {
    const launchRow = await launch("explicit");
    const saved = await variant(launchRow.id);
    await expect(invokeAgentTool("materialize_variant", { variantId: saved.id })).rejects.toMatchObject({ code: "APPROVAL_REQUIRED" });
    const materialized = await invokeAgentTool("materialize_variant", { variantId: saved.id, approval: { by: "user", evidence: { kind: "api", caller: "test" } } }) as { contentItemId: string };
    await invokeAgentTool("upsert_launch", {
      id: launchRow.id,
      name: launchRow.name,
      metadata: { writing: { spine: { message: { core: "A changed supported message." } } } },
    });
    expect(db.select().from(contentItems).where(eq(contentItems.id, materialized.contentItemId)).get()?.status).toBe("draft");
    expect(JSON.parse(db.select().from(variants).where(eq(variants.id, saved.id)).get()!.metadata ?? "{}").writing.approval).toMatchObject({ state: "revoked", revokedReason: "spine_changed" });
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
    const launchRow = await launch();
    const saved = await variant(launchRow.id);
    await invokeAgentTool("materialize_variant", { variantId: saved.id });
    await invokeAgentTool("revoke_variant_approval", { variantId: saved.id, reason: "user" });
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

  it("unlinks an unqueued materialization on delete and refuses publish-lane deletion", async () => {
    const launchRow = await launch();
    const saved = await variant(launchRow.id);
    const first = await invokeAgentTool("materialize_variant", { variantId: saved.id }) as { contentItemId: string };
    expect(deleteContentItem(first.contentItemId)).toBe(true);
    expect(db.select().from(variants).where(eq(variants.id, saved.id)).get()).toMatchObject({ contentItemId: null, status: "draft" });
    expect(db.select().from(graphEdges).where(eq(graphEdges.edgeType, "materialized_as")).all()).toHaveLength(0);

    const secondVariant = await variant(launchRow.id, "Another grounded variant.");
    const second = await invokeAgentTool("materialize_variant", { variantId: secondVariant.id }) as { contentItemId: string };
    db.update(contentItems).set({ status: "queued" }).where(eq(contentItems.id, second.contentItemId)).run();
    expect(() => deleteContentItem(second.contentItemId)).toThrow(/publish lane/i);
  });
});
