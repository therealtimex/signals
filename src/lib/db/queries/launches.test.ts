import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { invokeAgentTool } from "@/lib/agent-tools/invoke";
import { upsertLaunch } from "@/lib/db/queries/launches";
import {
  getVariantById,
  publishVariant,
  publishVariantForContentItem,
  upsertVariant,
} from "@/lib/db/queries/variants";
import { createContentItem } from "@/lib/db/queries/content";
import { db } from "@/lib/db/client";
import { contentItems, graphEdges, goals, launches, variants } from "@/lib/db/schema";
import { resetCoreTables } from "@/test/db";

describe("launches and variants", () => {
  beforeEach(() => {
    resetCoreTables();
  });

  it("creates a launch and variant via agent tools", async () => {
    const launch = await invokeAgentTool("upsert_launch", {
      name: "Q1 Product Launch",
      primaryPlatform: "x",
      brief: "Announce the new feature",
    });
    const launchId = (launch as { id: string }).id;

    const variant = await invokeAgentTool("upsert_variant", {
      launchId,
      label: "A",
      body: "Ship day thread",
      variantType: "post",
      predictedScore: 72,
    });

    expect(variant).toMatchObject({
      launchId,
      status: "draft",
    });

    const listed = await invokeAgentTool("query_launches", { search: "Q1" });
    expect(listed).toMatchObject({ total: 1 });
    const launchesResult = (listed as { launches: { variants: { label: string }[] }[] }).launches;
    expect(launchesResult[0]?.variants[0]?.label).toBe("A");
  });

  it("publishVariant materializes content, writes published_as, and is idempotent", () => {
    const launch = upsertLaunch({ name: "Publish Test", primaryPlatform: "linkedin" });
    const variant = upsertVariant({
      launchId: launch.id,
      label: "B",
      body: "Hello world",
      variantType: "post",
    });

    const first = publishVariant(variant.id, { platform: "linkedin", publishedAt: 1_700_000_000 });
    expect(first.status).toBe("published");
    expect(first.contentItemId).toBeTruthy();

    const content = db
      .select()
      .from(contentItems)
      .where(eq(contentItems.id, first.contentItemId!))
      .get();
    expect(content?.status).toBe("published");
    expect(content?.aiGenerated).toBe(true);

    const edges = db
      .select()
      .from(graphEdges)
      .where(eq(graphEdges.edgeType, "published_as"))
      .all();
    expect(edges).toHaveLength(1);
    expect(edges[0]?.srcType).toBe("variant");
    expect(edges[0]?.dstType).toBe("content");

    const second = publishVariant(variant.id, {
      platform: "linkedin",
      publishedAt: 1_700_000_100,
    });
    expect(second.contentItemId).toBe(first.contentItemId);
    expect(db.select().from(graphEdges).where(eq(graphEdges.edgeType, "published_as")).all()).toHaveLength(1);
    const refreshed = db
      .select()
      .from(graphEdges)
      .where(eq(graphEdges.edgeType, "published_as"))
      .get();
    expect(JSON.parse(refreshed?.properties ?? "{}")).toMatchObject({
      platform: "linkedin",
      published_at: 1_700_000_100,
    });
    expect(getVariantById(variant.id)?.status).toBe("published");
  });

  it("upsert_variant with status published delegates to publishVariant", async () => {
    const launch = await invokeAgentTool("upsert_launch", {
      name: "Agent Publish",
      primaryPlatform: "x",
    });
    const launchId = (launch as { id: string }).id;

    const published = await invokeAgentTool("upsert_variant", {
      launchId,
      body: "Auto publish copy",
      status: "published",
      platform: "x",
    });

    expect(published).toMatchObject({ status: "published" });
    expect(
      db.select().from(graphEdges).where(eq(graphEdges.edgeType, "published_as")).all(),
    ).toHaveLength(1);
  });

  it("query_launches returns goal links from contributes_to edges", async () => {
    const goalId = nanoid();
    db.insert(goals)
      .values({
        id: goalId,
        name: "Awareness",
        goalType: "audience_growth",
        platform: "x",
        targetValue: 100,
        currentValue: 0,
        unit: "impressions",
        status: "active",
      })
      .run();

    const launch = await invokeAgentTool("upsert_launch", { name: "Goal Linked Launch" });
    const launchId = (launch as { id: string }).id;

    await invokeAgentTool("upsert_edge", {
      srcType: "launch",
      srcId: launchId,
      dstType: "goal",
      dstId: goalId,
      edgeType: "contributes_to",
      scope: "shared",
    });

    const result = await invokeAgentTool("query_launches", { search: "Goal Linked" });
    const row = (result as { launches: { goalIds: string[] }[] }).launches[0];
    expect(row?.goalIds).toEqual([goalId]);
  });

  it("rejects invalid variant_type", () => {
    const launch = upsertLaunch({ name: "Invalid Variant" });
    expect(() =>
      upsertVariant({
        launchId: launch.id,
        variantType: "podcast",
        body: "nope",
      }),
    ).toThrow(/Invalid variant_type/);
  });

  it("applies update fields before publishing an existing variant", async () => {
    const launch = await invokeAgentTool("upsert_launch", {
      name: "Finalize Launch",
      primaryPlatform: "x",
    });
    const launchId = (launch as { id: string }).id;

    const created = await invokeAgentTool("upsert_variant", {
      launchId,
      label: "Draft",
      body: "old copy",
      variantType: "post",
    });
    const variantId = (created as { id: string }).id;

    const published = await invokeAgentTool("upsert_variant", {
      id: variantId,
      launchId,
      label: "Final",
      body: "fresh copy",
      predictedScore: 88,
      status: "published",
      platform: "x",
    });

    expect(published).toMatchObject({ status: "published" });

    const stored = getVariantById(variantId);
    expect(stored).toMatchObject({
      label: "Final",
      predictedScore: 88,
    });

    const content = db
      .select()
      .from(contentItems)
      .where(eq(contentItems.id, (published as { contentItemId: string }).contentItemId))
      .get();
    expect(content?.body).toBe("fresh copy");
  });

  it("preserves variantType on partial updates", () => {
    const launch = upsertLaunch({ name: "Partial Update", primaryPlatform: "x" });
    const variant = upsertVariant({
      launchId: launch.id,
      variantType: "thread",
      body: "thread body",
    });

    const updated = upsertVariant({
      id: variant.id,
      launchId: launch.id,
      label: "renamed",
    });

    expect(updated.variantType).toBe("thread");
  });

  it("requires a resolvable platform when publishing", () => {
    const launch = upsertLaunch({ name: "No Platform" });
    const variant = upsertVariant({
      launchId: launch.id,
      body: "copy",
    });

    expect(() => publishVariant(variant.id)).toThrow(/requires platform/i);
  });

  it("rejects invalid launch primaryPlatform values", () => {
    expect(() => upsertLaunch({ name: "Bad Platform", primaryPlatform: "myspace" })).toThrow(
      /Invalid platform/i,
    );
  });

  it("publishVariantForContentItem links an existing content item to published_as", () => {
    const launch = upsertLaunch({ name: "Hook Launch", primaryPlatform: "linkedin" });
    const content = createContentItem({
      body: "Already published copy",
      contentType: "post",
      platformTarget: "linkedin",
      status: "published",
      aiGenerated: true,
      origin: "authored",
      direction: "outbound",
    });
    const variant = upsertVariant({
      launchId: launch.id,
      body: "Already published copy",
      contentItemId: content.id,
    });

    const result = publishVariantForContentItem(content.id, {
      platform: "linkedin",
      publishedAt: 1_700_000_500,
    });

    expect(result?.status).toBe("published");
    expect(getVariantById(variant.id)?.status).toBe("published");
    expect(
      db.select().from(graphEdges).where(eq(graphEdges.edgeType, "published_as")).all(),
    ).toHaveLength(1);
  });
});
