import { beforeEach, describe, expect, it, vi } from "vitest";
import { nanoid } from "nanoid";
import { db } from "@/lib/db/client";
import { createContact, getContactById } from "@/lib/db/queries/contacts";
import { createIdentity, getIdentityById, updateIdentity } from "@/lib/db/queries/identities";
import { platformAccounts } from "@/lib/db/schema";
import { TierRestrictedError, type XUser } from "@/lib/platforms/x/client";
import type { XAnonWebTransport } from "@/lib/platforms/x/anon-web-transport";
import { RateLimitError } from "@/lib/platforms/rate-limiter";
import { enrichContactAvatars } from "@/lib/workflows/pipeline/handlers/enrich-contact-avatars";
import {
  hydrateXProfiles,
  type XUserLookup,
} from "@/lib/workflows/pipeline/handlers/hydrate-x-profiles";
import type { PipelineStepContext } from "@/lib/workflows/pipeline/types";
import { resetCoreTables } from "@/test/db";

const ctx: PipelineStepContext = {
  workflowRunId: "run-1",
  stepId: "hydrate",
  trigger: "template",
  forcePersona: false,
  personaStale: false,
  fetchImpl: fetch,
  env: process.env,
  appendThreadMessage: async () => undefined,
};

function seedAccount(input: { credentials?: string | null; status?: "active" | "needs_reauth" } = {}) {
  const id = nanoid();
  db.insert(platformAccounts).values({
    id,
    platform: "x",
    displayName: "@owner",
    authType: "oauth",
    credentialsEncrypted: input.credentials === undefined ? "encrypted" : input.credentials,
    status: input.status ?? "active",
  }).run();
  return id;
}

function seedArchiveContact(
  userId: string,
  input: { name?: string; platformData?: Record<string, unknown>; avatarUrl?: string } = {},
) {
  const contact = createContact({ name: input.name ?? `X user ${userId}` });
  const identity = createIdentity({
    contactId: contact.id,
    platform: "x",
    platformUserId: userId,
    platformUrl: `https://x.com/i/user/${userId}`,
    platformData: JSON.stringify(input.platformData ?? { archiveFollower: true }),
    avatarUrl: input.avatarUrl,
    isActive: 1,
  });
  return { contact, identity };
}

function xUser(id: string): XUser {
  return {
    id,
    name: `Person ${id}`,
    username: `person${id}`,
    description: `Bio ${id}`,
    location: "London",
    url: `https://example.com/${id}`,
    profile_image_url: `https://img.example.com/${id}_normal.jpg`,
    public_metrics: {
      followers_count: 100,
      following_count: 20,
      tweet_count: 30,
      listed_count: 4,
    },
    verified: true,
    created_at: "2020-01-02T03:04:05.000Z",
  };
}

describe("hydrateXProfiles", () => {
  beforeEach(() => {
    resetCoreTables();
    db.delete(platformAccounts).run();
    vi.restoreAllMocks();
  });

  it("hydrates gaps, preserves archive data and user fields, and renames placeholders", async () => {
    seedAccount();
    const { contact, identity } = seedArchiveContact("42", {
      platformData: { archiveFollower: true, archiveScreenName: "old_handle" },
    });
    const lookup = vi.fn<XUserLookup>(async () => ({ users: [xUser("42")], errors: [] }));

    const report = await hydrateXProfiles([contact.id], ctx, lookup);

    expect(report.outcomes).toEqual([{
      contactId: contact.id,
      status: "updated",
      detail: { source: "x_api", identityIds: [identity.id], handle: "@person42" },
    }]);
    expect(getContactById(contact.id)).toMatchObject({
      name: "Person 42",
      firstName: "Person",
      lastName: "42",
    });
    const hydrated = getIdentityById(identity.id)!;
    expect(hydrated).toMatchObject({
      displayName: "Person 42",
      platformHandle: "@person42",
      platformUrl: "https://x.com/person42",
      bio: "Bio 42",
      avatarUrl: "https://img.example.com/42_normal.jpg",
      location: "London",
      websiteUrl: "https://example.com/42",
      followersCount: 100,
      followingCount: 20,
      postsCount: 30,
      listedCount: 4,
      isVerified: true,
    });
    const platformData = JSON.parse(hydrated.platformData ?? "{}") as Record<string, unknown>;
    expect(platformData).toMatchObject({
      archiveFollower: true,
      archiveScreenName: "old_handle",
      profile_image_url: "https://img.example.com/42_normal.jpg",
      followersCount: 100,
      profileHydratedAt: expect.any(Number),
      profileHydratedVia: "x_api",
    });
    const avatarReport = await enrichContactAvatars(
      [contact.id],
      { ...ctx, stepId: "avatar" },
    );
    expect(avatarReport.outcomes[0]).toMatchObject({
      status: "skipped",
      reason: "avatar_present",
    });
  });

  it("does not overwrite user-edited identity/contact fields or accept an invalid avatar URL", async () => {
    seedAccount();
    const { contact, identity } = seedArchiveContact("7", { name: "My Edited Name" });
    updateIdentity(identity.id, {
      displayName: "Edited Display",
      platformHandle: "@edited",
      platformUrl: "https://x.com/edited",
      bio: "Edited bio",
      location: "Paris",
      websiteUrl: "https://edited.example.com",
    });
    const user = { ...xUser("7"), profile_image_url: "file:///tmp/avatar.png" };

    await hydrateXProfiles(
      [contact.id],
      ctx,
      async () => ({ users: [user], errors: [] }),
    );

    expect(getContactById(contact.id)?.name).toBe("My Edited Name");
    const hydrated = getIdentityById(identity.id)!;
    expect(hydrated).toMatchObject({
      displayName: "Edited Display",
      platformHandle: "@edited",
      platformUrl: "https://x.com/edited",
      bio: "Edited bio",
      avatarUrl: null,
      location: "Paris",
      websiteUrl: "https://edited.example.com",
    });
    expect(JSON.parse(hydrated.platformData ?? "{}")).toMatchObject({
      profile_image_url: "file:///tmp/avatar.png",
    });
  });

  it("chunks 120 unique numeric identities into 100 and 20 ID lookups", async () => {
    seedAccount();
    const contacts = Array.from({ length: 120 }, (_, index) => seedArchiveContact(String(1000 + index)));
    const lookup = vi.fn<XUserLookup>(async (_accountId, ids) => ({
      users: ids.map(xUser),
      errors: [],
    }));

    const report = await hydrateXProfiles(contacts.map(({ contact }) => contact.id), ctx, lookup);

    expect(lookup.mock.calls.map((call) => call[1].length)).toEqual([100, 20]);
    expect(report.outcomes).toHaveLength(120);
    expect(report.outcomes.every((outcome) => outcome.status === "updated")).toBe(true);
  });

  it("prefetches the authenticated API batch once for contact-major execution", async () => {
    seedAccount();
    const contacts = Array.from({ length: 120 }, (_, index) => seedArchiveContact(String(2000 + index)));
    const contactIds = contacts.map(({ contact }) => contact.id);
    const lookup = vi.fn<XUserLookup>(async (_accountId, ids) => ({
      users: ids.map(xUser),
      errors: [],
    }));
    const runScope = {
      contactIds,
      resources: new Map<string, unknown>(),
      deferCleanup: vi.fn(),
    };

    const first = await hydrateXProfiles([contactIds[0]!], { ...ctx, runScope }, lookup);
    const second = await hydrateXProfiles([contactIds[1]!], { ...ctx, runScope }, lookup);

    expect(lookup.mock.calls.map((call) => call[1].length)).toEqual([100, 20]);
    expect(first.outcomes[0]).toMatchObject({ status: "updated" });
    expect(second.outcomes[0]).toMatchObject({ status: "updated" });
    expect(runScope.deferCleanup).not.toHaveBeenCalled();
  });

  it("caches explicit not-found errors and skips both found and missing profiles on a second run", async () => {
    seedAccount();
    const found = seedArchiveContact("1");
    const missing = seedArchiveContact("2");
    const lookup = vi.fn<XUserLookup>(async () => ({
      users: [xUser("1")],
      errors: [{ resource_id: "2", title: "Not Found" }],
    }));

    const first = await hydrateXProfiles([found.contact.id, missing.contact.id], ctx, lookup);
    expect(first.outcomes.map((outcome) => [outcome.status, outcome.reason])).toEqual([
      ["updated", undefined],
      ["skipped", "not_found"],
    ]);
    const missingData = JSON.parse(getIdentityById(missing.identity.id)?.platformData ?? "{}") as Record<string, unknown>;
    expect(missingData.profileHydrationMiss).toMatchObject({ status: "not_found", at: expect.any(Number) });

    const secondLookup = vi.fn<XUserLookup>();
    const second = await hydrateXProfiles([found.contact.id, missing.contact.id], ctx, secondLookup);
    expect(secondLookup).not.toHaveBeenCalled();
    expect(second.outcomes.map((outcome) => outcome.reason)).toEqual(["fresh", "not_found_cached"]);
  });

  it("uses anonymous web hydration when OAuth credentials are absent", async () => {
    const disconnected = seedArchiveContact("9");
    const lookup = vi.fn<XUserLookup>();
    const webTransport = vi.fn<XAnonWebTransport>(async () => new Map([
      ["9", { status: "hydrated", user: xUser("9"), resolvedHandle: "person9" }],
    ]));

    const report = await hydrateXProfiles([disconnected.contact.id], ctx, lookup, webTransport);
    expect(report.outcomes[0]).toEqual({
      contactId: disconnected.contact.id,
      status: "updated",
      detail: { source: "x_web_anon", identityIds: [disconnected.identity.id], handle: "@person9" },
    });
    expect(lookup).not.toHaveBeenCalled();
    expect(webTransport).toHaveBeenCalledWith(
      [{ userId: "9", knownHandle: undefined }],
      expect.objectContaining({ fetchImpl: ctx.fetchImpl, env: ctx.env }),
    );
    expect(JSON.parse(getIdentityById(disconnected.identity.id)?.platformData ?? "{}")).toMatchObject({
      profileHydratedVia: "x_web_anon",
    });
    const avatarReport = await enrichContactAvatars(
      [disconnected.contact.id],
      { ...ctx, stepId: "avatar" },
    );
    expect(avatarReport.outcomes[0]).toMatchObject({ status: "skipped", reason: "avatar_present" });
  });

  it("prefers the official API when credentials exist and allows the web fallback to be disabled", async () => {
    const credentialed = seedArchiveContact("8");
    seedAccount();
    const lookup = vi.fn<XUserLookup>(async () => ({ users: [xUser("8")], errors: [] }));
    const webTransport = vi.fn<XAnonWebTransport>();
    await hydrateXProfiles([credentialed.contact.id], ctx, lookup, webTransport);
    expect(lookup).toHaveBeenCalledOnce();
    expect(webTransport).not.toHaveBeenCalled();

    resetCoreTables();
    db.delete(platformAccounts).run();
    const disabled = seedArchiveContact("12");
    const disabledReport = await hydrateXProfiles(
      [disabled.contact.id],
      { ...ctx, options: { webFallback: false } },
      lookup,
      webTransport,
    );
    expect(disabledReport.outcomes[0]?.reason).toBe("x_not_connected");
    expect(webTransport).not.toHaveBeenCalled();
  });

  it("keeps credentialed reauth failures on the official API path", async () => {
    const disconnected = seedArchiveContact("9");
    const lookup = vi.fn<XUserLookup>();
    const webTransport = vi.fn<XAnonWebTransport>();

    seedAccount({ status: "needs_reauth" });
    const reauth = await hydrateXProfiles([disconnected.contact.id], ctx, lookup, webTransport);
    expect(reauth.outcomes[0]?.reason).toBe("x_reauth_required");
    expect(lookup).not.toHaveBeenCalled();
    expect(webTransport).not.toHaveBeenCalled();
  });

  it("caches suspended web misses and browser-resolved handles only on retryable skips", async () => {
    const suspended = seedArchiveContact("10");
    const retryable = seedArchiveContact("11");
    const firstTransport = vi.fn<XAnonWebTransport>(async () => new Map([
      ["10", { status: "miss", missStatus: "suspended", resolvedHandle: "suspended_user" }],
      ["11", {
        status: "skip",
        reason: "x_web_parse_failed",
        resolvedHandle: "resolved_user",
      }],
    ]));
    const first = await hydrateXProfiles(
      [suspended.contact.id, retryable.contact.id],
      ctx,
      vi.fn<XUserLookup>(),
      firstTransport,
    );
    expect(first.outcomes).toMatchObject([
      { status: "skipped", reason: "x_suspended", detail: { source: "x_web_anon" } },
      { status: "skipped", reason: "x_web_parse_failed", detail: { source: "x_web_anon" } },
    ]);
    expect(JSON.parse(getIdentityById(suspended.identity.id)?.platformData ?? "{}")).toMatchObject({
      profileHydrationMiss: { status: "suspended", at: expect.any(Number) },
    });
    expect(JSON.parse(getIdentityById(retryable.identity.id)?.platformData ?? "{}")).toMatchObject({
      anonHandleResolution: { handle: "resolved_user", at: expect.any(Number) },
    });

    const secondTransport = vi.fn<XAnonWebTransport>(async () => new Map([
      ["11", { status: "skip", reason: "x_web_deferred" }],
    ]));
    const second = await hydrateXProfiles(
      [suspended.contact.id, retryable.contact.id],
      ctx,
      vi.fn<XUserLookup>(),
      secondTransport,
    );
    expect(second.outcomes[0]?.reason).toBe("not_found_cached");
    expect(secondTransport).toHaveBeenCalledWith(
      [{ userId: "11", knownHandle: "resolved_user" }],
      expect.any(Object),
    );
  });

  it.each([
    [new RateLimitError("/users", 120), "x_rate_limited", { retryAfter: 120 }],
    [new TierRestrictedError("/users", "Upgrade"), "x_access_restricted", undefined],
  ])("maps credential-class lookup failures to actionable skips", async (error, reason, detail) => {
    seedAccount();
    const { contact, identity } = seedArchiveContact("99");
    const report = await hydrateXProfiles(
      [contact.id],
      ctx,
      async () => { throw error; },
    );
    expect(report.outcomes[0]).toMatchObject({ status: "skipped", reason, ...(detail ? { detail } : {}) });
    const data = JSON.parse(getIdentityById(identity.id)?.platformData ?? "{}") as Record<string, unknown>;
    expect(data).not.toHaveProperty("profileHydrationMiss");
  });
});
