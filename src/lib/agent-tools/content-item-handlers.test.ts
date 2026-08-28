import { beforeEach, describe, expect, it } from "vitest";
import { invokeAgentTool } from "@/lib/agent-tools/invoke";
import { AgentToolError } from "@/lib/agent-tools/types";
import { PLATFORMS } from "@/lib/db/platforms";
import { createContentItem, getContentItem, updateContentItem } from "@/lib/db/queries/content";
import { upsertLaunch } from "@/lib/db/queries/launches";
import { createMediaAsset, linkMediaToContent } from "@/lib/db/queries/media";
import { resetCoreTables } from "@/test/db";

type ToolResult = Record<string, unknown>;

async function invoke(tool: string, input: Record<string, unknown>): Promise<ToolResult> {
  return (await invokeAgentTool(tool, input)) as ToolResult;
}

describe("writing content agent tools", () => {
  beforeEach(() => resetCoreTables());

  it("redacts every private sentinel until a matching persisted source grants approval", async () => {
    const sentinel = "PRIVATE-SENTINEL-DO-NOT-LEAK";
    const item = createContentItem({
      title: `${sentinel} title`,
      body: sentinel,
      contentType: "email",
      status: "imported",
      origin: "received",
      direction: "inbound",
      platformData: JSON.stringify({ raw: sentinel }),
    });
    const media = createMediaAsset({
      filename: `${sentinel}.png`,
      storagePath: "private.png",
      mimeType: "image/png",
      fileSize: 1,
    });
    linkMediaToContent(media.id, item.id);
    const launch = upsertLaunch({
      name: "Private source",
      metadata: {
        writing: {
          sources: [
            {
              id: "src_email",
              kind: "content_item",
              contentItemId: item.id,
              sensitivity: { level: "public", reason: "public_default" },
            },
          ],
        },
      },
    });

    const redacted = await invoke("get_content", { contentItemId: item.id });
    expect(redacted).toMatchObject({
      contentItem: {
        title: null,
        body: null,
        redacted: true,
        sensitivity: { level: "private" },
      },
      media: [],
    });
    expect(JSON.stringify(redacted)).not.toContain(sentinel);

    const wrongSource = await invoke("get_content", {
      contentItemId: item.id,
      writingSource: { launchId: launch.id, sourceId: "src_wrong" },
    });
    expect(wrongSource).toMatchObject({ contentItem: { redacted: true } });

    upsertLaunch({
      id: launch.id,
      name: launch.name,
      metadata: {
        writing: {
          sources: [
            {
              id: "src_email",
              kind: "content_item",
              contentItemId: item.id,
              sensitivity: {
                level: "private",
                reason: "private_content_type",
                contextApproval: {
                  by: "user",
                  at: 10,
                  evidence: {
                    kind: "thread_message",
                    workspaceSlug: "signals",
                    threadSlug: "writing-review",
                    note: "approved",
                  },
                },
              },
            },
          ],
        },
      },
    });
    const approved = await invoke("get_content", {
      contentItemId: item.id,
      writingSource: { launchId: launch.id, sourceId: "src_email" },
    });
    expect(approved).toMatchObject({
      contentItem: { body: sentinel, sensitivity: { level: "private" } },
    });
  });

  it.each([
    [
      "thread message",
      {
        kind: "thread_message",
        workspaceSlug: "signals",
        threadSlug: "writing-review",
      },
    ],
    ["UI", { kind: "ui", route: "/dashboard/launches/launch_1" }],
    ["API", { kind: "api", caller: "signals-api" }],
  ])("accepts durable user approval with %s evidence", async (_label, evidence) => {
    const sentinel = "VALID-CONTEXT-APPROVAL";
    const item = createContentItem({
      body: sentinel,
      contentType: "email",
      direction: "inbound",
      status: "imported",
    });
    const launch = upsertLaunch({
      name: "Approved source",
      metadata: {
        writing: {
          sources: [
            {
              id: "src_email",
              kind: "content_item",
              contentItemId: item.id,
              sensitivity: {
                level: "private",
                reason: "private_content_type",
                contextApproval: { by: "user", at: 10, evidence },
              },
            },
          ],
        },
      },
    });

    const approved = await invoke("get_content", {
      contentItemId: item.id,
      writingSource: { launchId: launch.id, sourceId: "src_email" },
    });
    expect(approved).toMatchObject({ contentItem: { body: sentinel } });
  });

  it.each([
    ["absent", undefined],
    ["scalar", "false"],
    ["empty object", {}],
    [
      "wrong actor",
      { by: "agent", at: 10, evidence: { kind: "api", caller: "agent" } },
    ],
    ["missing timestamp", { by: "user", evidence: { kind: "ui", route: "/launch" } }],
    [
      "negative timestamp",
      { by: "user", at: -1, evidence: { kind: "ui", route: "/launch" } },
    ],
    ["missing evidence", { by: "user", at: 10 }],
    [
      "malformed evidence",
      { by: "user", at: 10, evidence: { kind: "thread_message", workspaceSlug: "signals" } },
    ],
    ["unknown evidence", { by: "user", at: 10, evidence: { kind: "other" } }],
  ])(
    "keeps private content, sources, and brief redacted for %s approval",
    async (_label, contextApproval) => {
      const sentinel = "MALFORMED-CONTEXT-APPROVAL-SENTINEL";
      const item = createContentItem({
        title: sentinel,
        body: sentinel,
        contentType: "email",
        direction: "inbound",
        status: "imported",
      });
      const launch = upsertLaunch({
        name: "Malformed approval",
        brief: sentinel,
        metadata: {
          writing: {
            sources: [
              {
                id: "src_email",
                kind: "content_item",
                contentItemId: item.id,
                sensitivity: {
                  level: "private",
                  reason: "private_content_type",
                  contextApproval,
                },
              },
              {
                id: "src_note",
                kind: "note",
                text: sentinel,
                sensitivity: {
                  level: "private",
                  reason: "user_marked",
                  contextApproval,
                },
              },
              {
                id: "src_brief",
                kind: "brief",
                launchId: "placeholder",
                sensitivity: {
                  level: "private",
                  reason: "user_marked",
                  contextApproval,
                },
              },
            ],
          },
        },
      });
      const metadata = JSON.parse(launch.metadata ?? "{}");
      metadata.writing.sources[2].launchId = launch.id;
      upsertLaunch({ id: launch.id, name: launch.name, brief: launch.brief, metadata });

      const content = await invoke("get_content", {
        contentItemId: item.id,
        writingSource: { launchId: launch.id, sourceId: "src_email" },
      });
      expect(content).toMatchObject({
        contentItem: { title: null, body: null, redacted: true },
      });
      expect(JSON.stringify(content)).not.toContain(sentinel);

      const context = await invoke("get_writing_context", { launchId: launch.id });
      expect(context).toMatchObject({ launch: { brief: null, briefRedacted: true } });
      expect(context.sources).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: "src_email", redacted: true }),
          expect.objectContaining({ id: "src_note", redacted: true }),
          expect.objectContaining({ id: "src_brief", redacted: true }),
        ]),
      );
      expect(JSON.stringify(context)).not.toContain(sentinel);
    },
  );

  it("returns an untruncated detail body while query_content remains a summary", async () => {
    const body = "x".repeat(10_240);
    const item = createContentItem({ body, contentType: "post", status: "draft" });
    const detail = await invoke("get_content", { contentItemId: item.id });
    expect((detail.contentItem as { body: string }).body).toHaveLength(10_240);
    const query = await invoke("query_content", {});
    expect(((query.items as Array<{ body: string }>)[0].body)).toHaveLength(200);
  });

  it("creates one-platform drafts across the registry and stamps honest capabilities", async () => {
    const results = new Map<string, ToolResult>();
    for (const platform of PLATFORMS) {
      results.set(
        platform,
        await invoke("create_content_draft", {
          idempotencyKey: `registry-${platform}`,
          platform,
          contentType: "post",
          body: `Draft for ${platform}`,
        }),
      );
    }
    expect(results.get("x")).toMatchObject({ surface: "x/post", capability: { publish: "direct" } });
    expect(results.get("linkedin")).toMatchObject({
      surface: "linkedin/post",
      capability: { publish: "beta" },
    });
    expect(results.get("threads")).toMatchObject({
      surface: "threads/post",
      capability: { publish: "draft_only" },
    });
    expect(results.get("instagram")).toMatchObject({
      surface: null,
      capability: { publish: "draft_only" },
    });
    for (const result of results.values()) {
      const item = getContentItem(result.contentItemId as string)!;
      expect(item.platformTarget).not.toContain(",");
      expect(item.status).toBe("draft");
    }
    await expect(
      invokeAgentTool("create_content_draft", {
        idempotencyKey: "comma",
        platform: "x,linkedin",
        contentType: "post",
        body: "bad",
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("makes create replay idempotent and ignores changed retry input", async () => {
    const first = await invoke("create_content_draft", {
      idempotencyKey: "stable-key",
      platform: "x",
      contentType: "post",
      body: "first",
    });
    const replay = await invoke("create_content_draft", {
      idempotencyKey: "stable-key",
      platform: "linkedin",
      contentType: "post",
      body: "different",
    });
    expect(replay).toMatchObject({ contentItemId: first.contentItemId, created: false });
    expect(getContentItem(first.contentItemId as string)?.body).toBe("first");
    const distinct = await invoke("create_content_draft", {
      idempotencyKey: "another-key",
      platform: "x",
      contentType: "post",
      body: "first",
    });
    expect(distinct.contentItemId).not.toBe(first.contentItemId);
  });

  it("enforces thread shape and bounded optimistic revisions", async () => {
    await expect(
      invokeAgentTool("create_content_draft", {
        idempotencyKey: "bad-thread",
        platform: "linkedin",
        contentType: "thread",
        body: "A",
        threadTexts: ["B"],
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(
      invokeAgentTool("create_content_draft", {
        idempotencyKey: "bad-post",
        platform: "x",
        contentType: "post",
        body: "A",
        threadTexts: ["B"],
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });

    const created = await invoke("create_content_draft", {
      idempotencyKey: "thread",
      platform: "x",
      contentType: "thread",
      body: "A",
      threadTexts: ["B", "C"],
    });
    const id = created.contentItemId as string;
    const before = getContentItem(id)!;
    const first = await invoke("update_content_draft", {
      contentItemId: id,
      body: "A2",
      expectedUpdatedAt: before.updatedAt,
    });
    expect(first).toMatchObject({ units: { count: 3, chars: [2, 1, 1] } });
    expect(first.updatedAt as number).toBeGreaterThan(before.updatedAt);
    const second = await invoke("update_content_draft", {
      contentItemId: id,
      threadTexts: ["B2"],
      expectedUpdatedAt: first.updatedAt,
    });
    expect(second.updatedAt as number).toBeGreaterThan(first.updatedAt as number);
    await expect(
      invokeAgentTool("update_content_draft", {
        contentItemId: id,
        body: "stale",
        expectedUpdatedAt: before.updatedAt,
      }),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      details: { currentUpdatedAt: second.updatedAt },
    });

    updateContentItem(id, { status: "approved" });
    await expect(
      invokeAgentTool("update_content_draft", { contentItemId: id, body: "blocked" }),
    ).rejects.toMatchObject({ code: "CONFLICT", details: { status: "approved" } });
    const legacy = createContentItem({ body: "legacy", contentType: "post", status: "draft" });
    await expect(
      invokeAgentTool("update_content_draft", {
        contentItemId: legacy.id,
        body: "agent stomp",
      }),
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      details: { reason: "not_a_writing_draft" },
    });
  });

  it("returns uniformly privacy-filtered launch context and literal null voice", async () => {
    const sentinel = "CONTEXT-PRIVATE-SENTINEL";
    const sourceItem = createContentItem({
      title: "Private source",
      body: sentinel,
      contentType: "dm",
      direction: "inbound",
      status: "imported",
    });
    const launch = upsertLaunch({
      name: "Context launch",
      brief: sentinel,
      metadata: {
        writing: {
          surfaces: [{ platform: "x", surface: "x/thread" }],
          sources: [
            {
              id: "src_private",
              kind: "content_item",
              contentItemId: sourceItem.id,
              sensitivity: { level: "public", reason: "public_default" },
            },
            {
              id: "src_note",
              kind: "note",
              text: sentinel,
              sensitivity: { level: "private", reason: "user_marked" },
            },
            {
              id: "src_brief",
              kind: "brief",
              launchId: "placeholder",
              sensitivity: { level: "private", reason: "user_marked" },
            },
          ],
          spine: {
            schemaVersion: 1,
            id: "spine_private",
            launchId: "placeholder",
            sources: [{ id: "nested_source", text: sentinel }],
            claims: [{ id: "nested_claim", text: sentinel }],
            message: {
              core: sentinel,
              supporting: [sentinel],
            },
          },
          futurePrivateField: { nested: sentinel },
        },
      },
    });
    const metadata = JSON.parse(launch.metadata ?? "{}");
    metadata.writing.sources[2].launchId = launch.id;
    metadata.writing.spine.launchId = launch.id;
    upsertLaunch({ id: launch.id, name: launch.name, brief: launch.brief, metadata });

    const context = await invoke("get_writing_context", { launchId: launch.id });
    expect(context).toMatchObject({
      launch: { brief: null, briefRedacted: true },
      capabilities: { "x/thread": { publish: "direct" } },
      voiceProfile: null,
      approvalPolicy: "explicit",
    });
    expect(JSON.stringify(context)).not.toContain(sentinel);
    expect(context).not.toHaveProperty("launch.writing.spine");
    expect(context).not.toHaveProperty("launch.writing.futurePrivateField");
    expect(context.sources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "src_private", redacted: true }),
        expect.objectContaining({ id: "src_note", redacted: true }),
      ]),
    );

    const withoutSources = await invoke("get_writing_context", {
      launchId: launch.id,
      includeSources: false,
    });
    expect(withoutSources).not.toHaveProperty("sources");
    expect(withoutSources).not.toHaveProperty("launch.writing.sources");
    expect(withoutSources).not.toHaveProperty("launch.writing.spine");
    expect(JSON.stringify(withoutSources)).not.toContain(sentinel);

    const local = upsertLaunch({ name: "Local", brief: sentinel, scope: "local_only" });
    const localContext = await invoke("get_writing_context", { launchId: local.id });
    expect(localContext).toMatchObject({ launch: { brief: null, briefRedacted: true } });
    expect(JSON.stringify(localContext)).not.toContain(sentinel);
  });

  it("uses the standard structured error envelope", async () => {
    await expect(
      invokeAgentTool("get_content", { contentItemId: "missing" }),
    ).rejects.toBeInstanceOf(AgentToolError);
    await expect(
      invokeAgentTool("get_writing_context", {
        launchId: "missing",
        surfaces: ["unknown/post"],
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });
});
