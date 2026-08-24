import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import * as enrichmentRecalc from "@/lib/db/contact-enrichment-recalc";
import { createContactChannel } from "@/lib/db/queries/contact-channels";
import { createContact } from "@/lib/db/queries/contacts";
import { createIdentity, getIdentityById, updateIdentity } from "@/lib/db/queries/identities";
import { createMediaAsset } from "@/lib/db/queries/media";
import { createMediaAttachment } from "@/lib/db/queries/media-attachments";
import { db } from "@/lib/db/client";
import { contacts } from "@/lib/db/schema";
import type { PipelineStepContext } from "@/lib/workflows/pipeline/types";
import { enrichContactAvatars } from "@/lib/workflows/pipeline/handlers/enrich-contact-avatars";
import { resetCoreTables } from "@/test/db";

function buildCtx(fetchImpl: typeof fetch): PipelineStepContext {
  return {
    workflowRunId: "run-test",
    stepId: "avatar",
    trigger: "template",
    forcePersona: false,
    personaStale: false,
    fetchImpl,
    env: {},
    appendThreadMessage: vi.fn(async () => undefined),
  };
}

function readAvatarEnrich(contactId: string) {
  const row = db.select().from(contacts).where(eq(contacts.id, contactId)).get();
  const metadata = JSON.parse(row?.metadata ?? "{}") as {
    avatarEnrich?: Record<string, number>;
  };
  return metadata.avatarEnrich ?? {};
}

describe("enrichContactAvatars", () => {
  beforeEach(() => {
    resetCoreTables();
    vi.restoreAllMocks();
  });

  it("skips avatar_present when an active identity already has avatar_url", async () => {
    const contact = createContact({ name: "Has Avatar", platform: "x", platformUserId: "has-avatar" });
    createIdentity({
      contactId: contact.id,
      platform: "x",
      platformUserId: "has-avatar",
      avatarUrl: "https://cdn.example/avatar.jpg",
      isPrimary: 1,
      isActive: 1,
    });

    const recalcSpy = vi.spyOn(enrichmentRecalc, "recalcContactEnrichment");
    const report = await enrichContactAvatars([contact.id], buildCtx(vi.fn()));

    expect(report.outcomes).toEqual([
      { contactId: contact.id, status: "skipped", reason: "avatar_present" },
    ]);
    expect(recalcSpy).not.toHaveBeenCalled();
  });

  it("skips avatar_present when a contact avatar upload attachment exists", async () => {
    const contact = createContact({ name: "Upload Avatar", platform: "x", platformUserId: "upload-avatar" });
    createIdentity({
      contactId: contact.id,
      platform: "x",
      platformUserId: "upload-avatar",
      isPrimary: 1,
      isActive: 1,
    });
    const asset = createMediaAsset({
      filename: "avatar.png",
      storagePath: "avatar.png",
      mimeType: "image/png",
      fileSize: 10,
      origin: "upload",
      scope: "shared",
    });
    createMediaAttachment({
      mediaAssetId: asset.id,
      parentType: "contact",
      parentId: contact.id,
      role: "avatar",
      source: "test",
    });

    const report = await enrichContactAvatars([contact.id], buildCtx(vi.fn()));

    expect(report.outcomes[0]).toMatchObject({
      contactId: contact.id,
      status: "skipped",
      reason: "avatar_present",
    });
  });

  it("skips no_identity when the contact has no active identities", async () => {
    const contact = createContact({ name: "No Identity" });

    const report = await enrichContactAvatars([contact.id], buildCtx(vi.fn()));

    expect(report.outcomes[0]).toMatchObject({
      contactId: contact.id,
      status: "skipped",
      reason: "no_identity",
    });
  });

  it("recovers avatar_url from platform_data profile_image_url with X upscale", async () => {
    const contact = createContact({ name: "Platform Data", platform: "x", platformUserId: "platform-data" });
    const identity = createIdentity({
      contactId: contact.id,
      platform: "x",
      platformUserId: "platform-data",
      platformData: JSON.stringify({
        profile_image_url: "https://pbs.twimg.com/profile_normal.jpg",
      }),
      isPrimary: 1,
      isActive: 1,
    });
    updateIdentity(identity.id, { avatarUrl: null });

    const recalcSpy = vi.spyOn(enrichmentRecalc, "recalcContactEnrichment");
    const report = await enrichContactAvatars([contact.id], buildCtx(vi.fn()));

    expect(report.outcomes[0]).toMatchObject({
      contactId: contact.id,
      status: "updated",
      detail: { source: "platform_data", identityId: identity.id },
    });
    expect(getIdentityById(identity.id)?.avatarUrl).toBe("https://pbs.twimg.com/profile_400x400.jpg");
    expect(recalcSpy).toHaveBeenCalledWith(contact.id);
  });

  it("recovers avatar_url from platform_data picture key", async () => {
    const contact = createContact({ name: "Picture", platform: "linkedin", platformUserId: "picture" });
    const identity = createIdentity({
      contactId: contact.id,
      platform: "linkedin",
      platformUserId: "picture",
      platformData: JSON.stringify({ picture: "https://media.licdn.com/photo.jpg" }),
      isPrimary: 1,
      isActive: 1,
    });
    updateIdentity(identity.id, { avatarUrl: null });

    const report = await enrichContactAvatars([contact.id], buildCtx(vi.fn()));

    expect(report.outcomes[0]?.status).toBe("updated");
    expect(getIdentityById(identity.id)?.avatarUrl).toBe("https://media.licdn.com/photo.jpg");
  });

  it("recovers avatar_url from platform_data photoUrl key", async () => {
    const contact = createContact({ name: "Photo Url", platform: "gmail", platformUserId: "photo-url" });
    const identity = createIdentity({
      contactId: contact.id,
      platform: "gmail",
      platformUserId: "photo-url",
      platformData: JSON.stringify({ photoUrl: "https://lh3.googleusercontent.com/a/photo" }),
      isPrimary: 1,
      isActive: 1,
    });
    updateIdentity(identity.id, { avatarUrl: null });

    const report = await enrichContactAvatars([contact.id], buildCtx(vi.fn()));

    expect(report.outcomes[0]?.status).toBe("updated");
    expect(getIdentityById(identity.id)?.avatarUrl).toBe("https://lh3.googleusercontent.com/a/photo");
  });

  it("rejects invalid platform_data avatar URLs and falls through to no_source", async () => {
    const contact = createContact({ name: "Invalid Platform", platform: "x", platformUserId: "invalid-platform" });
    const identity = createIdentity({
      contactId: contact.id,
      platform: "x",
      platformUserId: "invalid-platform",
      platformData: JSON.stringify({ profile_image_url: "file:///tmp/avatar.jpg" }),
      isPrimary: 1,
      isActive: 1,
    });
    updateIdentity(identity.id, { avatarUrl: null });

    const report = await enrichContactAvatars([contact.id], buildCtx(vi.fn()));

    expect(report.outcomes[0]).toMatchObject({
      contactId: contact.id,
      status: "skipped",
      reason: "no_source",
    });
    expect(readAvatarEnrich(contact.id).exhaustedAt).toBeTypeOf("number");
  });

  it("recovers legacyAvatarUrl onto the primary identity", async () => {
    const contact = createContact({
      name: "Legacy Avatar",
      platform: "x",
      platformUserId: "legacy-avatar",
      metadata: JSON.stringify({ legacyAvatarUrl: "https://legacy.example/avatar.jpg" }),
    });
    const identity = createIdentity({
      contactId: contact.id,
      platform: "x",
      platformUserId: "legacy-avatar",
      isPrimary: 1,
      isActive: 1,
    });

    const recalcSpy = vi.spyOn(enrichmentRecalc, "recalcContactEnrichment");
    const report = await enrichContactAvatars([contact.id], buildCtx(vi.fn()));

    expect(report.outcomes[0]).toMatchObject({
      contactId: contact.id,
      status: "updated",
      detail: { source: "legacy_metadata", identityId: identity.id },
    });
    expect(getIdentityById(identity.id)?.avatarUrl).toBe("https://legacy.example/avatar.jpg");
    expect(recalcSpy).toHaveBeenCalledWith(contact.id);
  });

  it("verifies gravatar on 200 and records gravatarVerifiedAt", async () => {
    const contact = createContact({ name: "Gravatar Hit", platform: "x", platformUserId: "gravatar-hit" });
    createIdentity({
      contactId: contact.id,
      platform: "x",
      platformUserId: "gravatar-hit",
      isPrimary: 1,
      isActive: 1,
    });
    createContactChannel({
      contactId: contact.id,
      channelType: "email",
      value: "Ada@Example.com",
      isPrimary: true,
      source: "test",
    });

    const hash = createHash("md5").update("ada@example.com").digest("hex");
    const fetchImpl = vi.fn(async (url: string) => {
      expect(url).toBe(`https://www.gravatar.com/avatar/${hash}?d=404`);
      return new Response(null, { status: 200 });
    });

    const recalcSpy = vi.spyOn(enrichmentRecalc, "recalcContactEnrichment");
    const report = await enrichContactAvatars([contact.id], buildCtx(fetchImpl as typeof fetch));

    expect(report.outcomes[0]).toMatchObject({
      contactId: contact.id,
      status: "verified",
      detail: { source: "gravatar" },
    });
    expect(readAvatarEnrich(contact.id).gravatarVerifiedAt).toBeTypeOf("number");
    expect(recalcSpy).not.toHaveBeenCalled();
  });

  it("records gravatarMissAt on 404 then marks no_source exhausted", async () => {
    const contact = createContact({ name: "Gravatar Miss", platform: "x", platformUserId: "gravatar-miss" });
    createIdentity({
      contactId: contact.id,
      platform: "x",
      platformUserId: "gravatar-miss",
      isPrimary: 1,
      isActive: 1,
    });
    createContactChannel({
      contactId: contact.id,
      channelType: "email",
      value: "missing@example.com",
      source: "test",
    });

    const fetchImpl = vi.fn(async () => new Response(null, { status: 404 }));
    const report = await enrichContactAvatars([contact.id], buildCtx(fetchImpl as typeof fetch));

    expect(report.outcomes[0]).toMatchObject({
      contactId: contact.id,
      status: "skipped",
      reason: "no_source",
    });
    const enrich = readAvatarEnrich(contact.id);
    expect(enrich.gravatarMissAt).toBeTypeOf("number");
    expect(enrich.exhaustedAt).toBeTypeOf("number");
  });

  it("fails gravatar probe network errors without setting exhaustedAt", async () => {
    const contact = createContact({ name: "Gravatar Error", platform: "x", platformUserId: "gravatar-error" });
    createIdentity({
      contactId: contact.id,
      platform: "x",
      platformUserId: "gravatar-error",
      isPrimary: 1,
      isActive: 1,
    });
    createContactChannel({
      contactId: contact.id,
      channelType: "email",
      value: "error@example.com",
      source: "test",
    });

    const fetchImpl = vi.fn(async () => {
      throw new Error("network down");
    });
    const report = await enrichContactAvatars([contact.id], buildCtx(fetchImpl as typeof fetch));

    expect(report.outcomes[0]?.status).toBe("failed");
    expect(report.outcomes[0]?.reason).toMatch(/network down/);
    expect(readAvatarEnrich(contact.id).exhaustedAt).toBeUndefined();
  });

  it("marks no_source with exhaustedAt when all sources are exhausted", async () => {
    const contact = createContact({ name: "No Source", platform: "x", platformUserId: "no-source" });
    createIdentity({
      contactId: contact.id,
      platform: "x",
      platformUserId: "no-source",
      platformData: JSON.stringify({ followersCount: 1 }),
      isPrimary: 1,
      isActive: 1,
    });

    const report = await enrichContactAvatars([contact.id], buildCtx(vi.fn()));

    expect(report.outcomes[0]).toMatchObject({
      contactId: contact.id,
      status: "skipped",
      reason: "no_source",
    });
    expect(readAvatarEnrich(contact.id).exhaustedAt).toBeTypeOf("number");
  });

  it("recovers avatar from X platform identity handle", async () => {
    const contact = createContact({ name: "Dev User" });
    const identity = createIdentity({
      contactId: contact.id,
      platform: "x",
      platformUserId: "torvalds",
      platformHandle: "torvalds",
      isPrimary: 1,
      isActive: 1,
    });

    const report = await enrichContactAvatars([contact.id], buildCtx(vi.fn()));

    expect(report.outcomes[0]).toMatchObject({
      contactId: contact.id,
      status: "updated",
      detail: { source: "identity_platform", identityId: identity.id },
    });
    expect(getIdentityById(identity.id)?.avatarUrl).toBe("https://unavatar.io/x/torvalds");
  });
});

