import { beforeEach, describe, expect, it, vi } from "vitest";
import { nanoid } from "nanoid";
import { db } from "@/lib/db/client";
import { createContact, getContactById } from "@/lib/db/queries/contacts";
import { createIdentity, getIdentityById, updateIdentity } from "@/lib/db/queries/identities";
import { platformAccounts } from "@/lib/db/schema";
import { TierRestrictedError, type XUser } from "@/lib/platforms/x/client";
import type {
  XAnonWebSession,
  XAnonWebTransport,
} from "@/lib/platforms/x/anon-web-transport";
import { RateLimitError } from "@/lib/platforms/rate-limiter";
import { enrichContactAvatars } from "@/lib/workflows/pipeline/handlers/enrich-contact-avatars";
import {
  hydrateXProfiles,
  type XUserLookup,
  type XUsernameLookup,
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

/** Contacts from agent research, CSV import or manual entry are keyed by handle, not by ID. */
function seedHandleContact(
  handle: string,
  input: { name?: string; platformHandle?: string | null } = {},
) {
  const contact = createContact({ name: input.name ?? `@${handle}` });
  const identity = createIdentity({
    contactId: contact.id,
    platform: "x",
    platformUserId: handle,
    platformHandle: input.platformHandle === undefined ? `@${handle}` : input.platformHandle,
    platformData: JSON.stringify({ createdVia: "agent_research" }),
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

function xProfileHtml(id: string, handle: string): string {
  return `<!doctype html>
<html><head>
  <title>Person ${id} (@${handle}) / X</title>
  <link rel="canonical" href="https://x.com/${handle}">
  <script type="application/ld+json">
  {
    "@type": "ProfilePage",
    "mainEntity": {
      "@type": "Person",
      "identifier": "${id}",
      "additionalName": "${handle}",
      "name": "Person ${id}",
      "image": {"contentUrl": "https://img.example.com/${id}_normal.jpg"}
    }
  }
  </script>
</head><body>Public profile</body></html>`;
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
      platformHandle: "person42",
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
      // Stored bare: the write layer strips the sigil the user typed above. What this test
      // guards is that hydration keeps the edit instead of replacing it with `person7`.
      platformHandle: "edited",
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

  it("hydrates handle-keyed identities by username and promotes them to the numeric ID", async () => {
    seedAccount();
    const { contact, identity } = seedHandleContact("sama");
    const lookup = vi.fn<XUserLookup>(async () => ({ users: [], errors: [] }));
    const handleLookup = vi.fn<XUsernameLookup>(async () => ({
      users: [{ ...xUser("1605"), username: "sama" }],
      errors: [],
    }));

    const report = await hydrateXProfiles([contact.id], ctx, lookup, undefined, handleLookup);

    expect(report.outcomes).toEqual([{
      contactId: contact.id,
      status: "updated",
      detail: { source: "x_api", identityIds: [identity.id], handle: "@sama" },
    }]);
    expect(lookup).not.toHaveBeenCalled();
    expect(handleLookup).toHaveBeenCalledWith(expect.any(String), ["sama"]);

    const stored = getIdentityById(identity.id);
    expect(stored?.platformUserId).toBe("1605");
    expect(stored?.displayName).toBe("Person 1605");
    expect(stored?.avatarUrl).toBe("https://img.example.com/1605_normal.jpg");

    const secondHandleLookup = vi.fn<XUsernameLookup>();
    const second = await hydrateXProfiles([contact.id], ctx, lookup, undefined, secondHandleLookup);
    expect(secondHandleLookup).not.toHaveBeenCalled();
    expect(second.outcomes[0]).toMatchObject({ status: "skipped", reason: "fresh" });
  });

  it("resolves handle-only identities over the anonymous web path and persists the numeric ID", async () => {
    const { contact, identity } = seedHandleContact("ylecun");
    const webTransport = vi.fn<XAnonWebTransport>(async () => new Map([
      ["handle:ylecun", {
        status: "hydrated",
        user: { ...xUser("48008938"), username: "ylecun" },
        resolvedHandle: "ylecun",
      }],
    ]));

    const report = await hydrateXProfiles([contact.id], ctx, vi.fn<XUserLookup>(), webTransport);

    expect(report.outcomes).toEqual([{
      contactId: contact.id,
      status: "updated",
      detail: { source: "x_web_anon", identityIds: [identity.id], handle: "@ylecun" },
    }]);
    expect(webTransport).toHaveBeenCalledWith(
      [{ userId: "handle:ylecun", knownHandle: "ylecun", handleOnly: true }],
      expect.objectContaining({ fetchImpl: ctx.fetchImpl, env: ctx.env }),
    );
    expect(getIdentityById(identity.id)?.platformUserId).toBe("48008938");
  });

  it("separates contacts with no X identity from identities that cannot be resolved", async () => {
    seedAccount();
    const noIdentity = createContact({ name: "No platforms" });
    const unusable = createContact({ name: "Unusable identity" });
    createIdentity({
      contactId: unusable.id,
      platform: "x",
      platformUserId: "https://x.com/some one",
      platformHandle: null,
      isActive: 1,
    });
    const lookup = vi.fn<XUserLookup>();
    const handleLookup = vi.fn<XUsernameLookup>();

    const report = await hydrateXProfiles(
      [noIdentity.id, unusable.id],
      ctx,
      lookup,
      undefined,
      handleLookup,
    );

    expect(report.outcomes.map((outcome) => [outcome.contactId, outcome.reason])).toEqual([
      [noIdentity.id, "no_x_identity"],
      [unusable.id, "x_identity_unresolved"],
    ]);
    expect(lookup).not.toHaveBeenCalled();
    expect(handleLookup).not.toHaveBeenCalled();
  });

  it("caches handles the API cannot resolve as misses rather than reporting no_x_identity", async () => {
    seedAccount();
    const { contact, identity } = seedHandleContact("ghost_handle");
    const handleLookup = vi.fn<XUsernameLookup>(async () => ({
      users: [],
      errors: [{ value: "ghost_handle", title: "Not Found Error" }],
    }));

    const first = await hydrateXProfiles(
      [contact.id],
      ctx,
      vi.fn<XUserLookup>(),
      undefined,
      handleLookup,
    );
    expect(first.outcomes[0]).toMatchObject({ status: "skipped", reason: "not_found" });
    expect(JSON.parse(getIdentityById(identity.id)?.platformData ?? "{}")).toMatchObject({
      profileHydrationMiss: { status: "not_found", at: expect.any(Number) },
    });

    const secondHandleLookup = vi.fn<XUsernameLookup>();
    const second = await hydrateXProfiles(
      [contact.id],
      ctx,
      vi.fn<XUserLookup>(),
      undefined,
      secondHandleLookup,
    );
    expect(secondHandleLookup).not.toHaveBeenCalled();
    expect(second.outcomes[0]).toMatchObject({ status: "skipped", reason: "not_found_cached" });
  });

  it("keeps the hydrated profile when the resolved ID already belongs to another identity", async () => {
    seedAccount();
    const existing = seedArchiveContact("1605");
    const { contact, identity } = seedHandleContact("sama");
    const handleLookup = vi.fn<XUsernameLookup>(async () => ({
      users: [{ ...xUser("1605"), username: "sama" }],
      errors: [],
    }));

    const report = await hydrateXProfiles(
      [contact.id],
      ctx,
      vi.fn<XUserLookup>(),
      undefined,
      handleLookup,
    );

    expect(report.outcomes[0]).toMatchObject({
      contactId: contact.id,
      status: "updated",
      detail: {
        source: "x_api",
        identityIds: [identity.id],
        userIdConflicts: [expect.any(String)],
      },
    });
    const stored = getIdentityById(identity.id);
    expect(stored?.platformUserId).toBe("sama");
    expect(stored?.displayName).toBe("Person 1605");
    expect(JSON.parse(stored?.platformData ?? "{}")).toMatchObject({
      userIdPromotion: { status: "conflict", resolvedUserId: "1605" },
    });
    expect(getIdentityById(existing.identity.id)?.platformUserId).toBe("1605");
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

  it("reuses and disposes one anonymous web session across contact-major calls", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const contacts = [seedArchiveContact("201"), seedArchiveContact("202")];
    for (const { identity } of contacts) {
      updateIdentity(identity.id, { platformHandle: `@person${identity.platformUserId}` });
    }
    const contactIds = contacts.map(({ contact }) => contact.id);
    const profiles = new Map(contacts.map(({ identity }) => [
      `person${identity.platformUserId}`,
      xProfileHtml(identity.platformUserId, `person${identity.platformUserId}`),
    ]));
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const handle = new URL(String(input)).pathname.slice(1);
      const html = profiles.get(handle);
      return new Response(html ?? "", {
        status: html ? 200 : 404,
        headers: { "content-type": "text/html" },
      });
    });
    const runScope = {
      contactIds,
      resources: new Map<string, unknown>(),
      deferCleanup: vi.fn(),
    };
    const scopedCtx = {
      ...ctx,
      fetchImpl,
      options: { minRequestGapMs: 0 },
      runScope,
    };

    const first = await hydrateXProfiles([contactIds[0]!], scopedCtx);
    const session = [...runScope.resources.values()][0] as XAnonWebSession;
    const second = await hydrateXProfiles([contactIds[1]!], scopedCtx);

    expect(first.outcomes[0]).toMatchObject({ status: "updated" });
    expect(second.outcomes[0]).toMatchObject({ status: "updated" });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls.map(([input]) => String(input))).toEqual([
      "https://x.com/person201",
      "https://x.com/person202",
    ]);
    expect(runScope.resources.size).toBe(1);
    expect([...runScope.resources.values()][0]).toBe(session);
    expect(runScope.deferCleanup).toHaveBeenCalledOnce();

    const cleanup = runScope.deferCleanup.mock.calls[0]![0] as () => Promise<void>;
    await cleanup();
    await expect(session.hydrate([{ userId: "203", knownHandle: "person203" }]))
      .rejects.toThrow("Anonymous X hydration session is disposed");
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
    expect(second.outcomes).toMatchObject([
      { contactId: suspended.contact.id, status: "skipped", reason: "not_found_cached" },
      {
        contactId: retryable.contact.id,
        status: "skipped",
        reason: "x_web_deferred",
        detail: { source: "x_web_anon" },
      },
    ]);
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
