import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  contentPosts,
  platformAccounts,
  platformTargets,
} from "@/lib/db/schema";
import { createContentItem, createContentPost } from "@/lib/db/queries/content";
import { createPlatformAccount } from "@/lib/db/queries/platform-accounts";
import {
  ensureBrowserConnection,
  forgetPlatformTarget,
  listPlatformTargets,
  registerPlatformTarget,
  resolveDefaultTarget,
  resolveTargetById,
  setDefaultTarget,
} from "@/lib/db/queries/platform-targets";
import { backfillPlatformTargets } from "@/lib/db/backfill-platform-targets";
import { normalizePlatformTargetIdentity } from "@/lib/platforms/target-identity";
import { resetCoreTables } from "@/test/db";

describe("platform target identity and registry", () => {
  beforeEach(() => {
    resetCoreTables();
    db.delete(platformAccounts).run();
  });

  it.each([
    ["x", "@Foo", { handle: "@Foo", handleNormalized: "foo", externalId: null }],
    ["linkedin", "/in/Foo-Bar", { handle: "/in/Foo-Bar", handleNormalized: "foo-bar", externalId: null }],
    ["facebook", "Some.Slug", { handle: "Some.Slug", handleNormalized: "some.slug", externalId: null }],
    ["facebook", "id:12345", { handle: null, handleNormalized: null, externalId: "12345" }],
  ] as const)("normalizes %s identity %s", (platform, raw, expected) => {
    expect(normalizePlatformTargetIdentity(platform, raw)).toEqual(expected);
  });

  it("adopts external IDs, re-homes, forgets, and resurrects a stable target ID", () => {
    const shared = ensureBrowserConnection({ sessionName: "shared" });
    const dedicated = ensureBrowserConnection({ sessionName: "dedicated", kind: "dedicated" });
    const provisional = registerPlatformTarget({
      connectionId: shared.id,
      platform: "x",
      kind: "account",
      name: "Foo",
      handle: "@Foo",
      source: "test",
    });
    const adopted = registerPlatformTarget({
      connectionId: dedicated.id,
      platform: "x",
      kind: "account",
      externalId: "42",
      name: "Foo Renamed",
      handle: "@Foo",
      source: "test",
    });
    expect(adopted.id).toBe(provisional.id);
    expect(adopted.externalId).toBe("42");
    expect(adopted.connectionId).toBe(dedicated.id);

    expect(forgetPlatformTarget(adopted.id)).toBe(true);
    expect(listPlatformTargets({ platform: "x" })).toHaveLength(0);
    const resurrected = registerPlatformTarget({
      connectionId: shared.id,
      platform: "x",
      kind: "account",
      externalId: "42",
      name: "Foo Again",
      handle: "@newfoo",
      source: "test",
    });
    expect(resurrected.id).toBe(adopted.id);
    expect(resurrected.status).toBe("active");
    expect(resurrected.handleNormalized).toBe("newfoo");
  });

  it("merges a provisional target into the external-ID owner and repoints audit rows", () => {
    const connection = ensureBrowserConnection({ sessionName: "shared" });
    const account = createPlatformAccount({
      platform: "x",
      displayName: "@foo",
      authType: "session",
      credentialsEncrypted: null,
      status: "active",
    });
    const provisional = registerPlatformTarget({
      connectionId: connection.id,
      platform: "x",
      kind: "account",
      name: "Foo",
      handle: "@foo",
      platformAccountId: account.id,
      source: "test",
    });
    const canonical = registerPlatformTarget({
      connectionId: connection.id,
      platform: "x",
      kind: "account",
      externalId: "42",
      name: "Old Foo",
      handle: "@oldfoo",
      platformAccountId: account.id,
      source: "test",
    });
    const item = createContentItem({ contentType: "post", status: "published" });
    const post = createContentPost({
      contentItemId: item.id,
      platformAccountId: account.id,
      targetId: provisional.id,
      platformPostId: "post-1",
      status: "published",
    });

    const merged = registerPlatformTarget({
      connectionId: connection.id,
      platform: "x",
      kind: "account",
      externalId: "42",
      name: "Foo",
      handle: "@foo",
      platformAccountId: account.id,
      source: "test",
    });
    expect(merged.id).toBe(canonical.id);
    expect(resolveTargetById(provisional.id)?.id).toBe(canonical.id);
    expect(
      db.select().from(contentPosts).where(eq(contentPosts.id, post.id)).get()?.targetId
    ).toBe(canonical.id);
    expect(
      db.select().from(platformTargets).where(eq(platformTargets.id, provisional.id)).get()
    ).toMatchObject({ status: "merged", mergedIntoTargetId: canonical.id, isDefault: false });
  });

  it("resolves a deterministic default and backfills idempotently", () => {
    const account = createPlatformAccount({
      platform: "x",
      displayName: "@backfill",
      authType: "session",
      credentialsEncrypted: null,
      status: "active",
    });
    expect(backfillPlatformTargets()).toEqual({ connectionsCreated: 1, targetsCreated: 1 });
    const firstRows = db.select().from(platformTargets).all();
    expect(backfillPlatformTargets()).toEqual({ connectionsCreated: 0, targetsCreated: 0 });
    expect(db.select().from(platformTargets).all()).toEqual(firstRows);

    const connection = ensureBrowserConnection({ sessionName: "dedicated", kind: "dedicated" });
    const adopted = registerPlatformTarget({
      connectionId: connection.id,
      platform: "x",
      kind: "account",
      externalId: "42",
      name: "Backfill renamed",
      handle: "@backfill",
      platformAccountId: account.id,
      source: "user",
      verifiedAt: 123,
    });
    const second = registerPlatformTarget({
      connectionId: connection.id,
      platform: "x",
      kind: "account",
      name: "Second",
      handle: "@second",
      source: "test",
    });
    setDefaultTarget(second.id);
    expect(resolveDefaultTarget("x")?.id).toBe(second.id);

    const customizedRows = db.select().from(platformTargets).all();
    expect(backfillPlatformTargets()).toEqual({ connectionsCreated: 0, targetsCreated: 0 });
    expect(db.select().from(platformTargets).all()).toEqual(customizedRows);
    expect(resolveTargetById(adopted.id)).toMatchObject({
      connectionId: connection.id,
      externalId: "42",
      lastVerifiedAt: 123,
    });
    expect(resolveDefaultTarget("x")?.id).toBe(second.id);

    forgetPlatformTarget(second.id);
    expect(resolveDefaultTarget("x")?.id).toBe(firstRows[0]?.id);
  });
});
