import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nanoid } from "nanoid";
import { encrypt } from "@/lib/auth/crypto";
import { db } from "@/lib/db/client";
import { platformAccounts } from "@/lib/db/schema";
import { getPlatformAccountById } from "@/lib/db/queries/platform-accounts";
import {
  getUsersByIds,
  getUsersByUsernames,
  TierRestrictedError,
  X_USER_LOOKUP_MAX_IDS,
  X_USER_LOOKUP_MAX_USERNAMES,
} from "@/lib/platforms/x/client";
import { RateLimitError } from "@/lib/platforms/rate-limiter";
import { resetCoreTables } from "@/test/db";

function seedAccount(): string {
  const id = nanoid();
  db.insert(platformAccounts).values({
    id,
    platform: "x",
    displayName: "@owner",
    authType: "oauth",
    credentialsEncrypted: encrypt(JSON.stringify({
      accessToken: "token",
      refreshToken: "refresh",
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
    })),
  }).run();
  return id;
}

describe("getUsersByIds", () => {
  beforeEach(() => {
    resetCoreTables();
    db.delete(platformAccounts).run();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns partial users and per-id errors from one stable /users request", async () => {
    const accountId = seedAccount();
    const reset = Math.floor(Date.now() / 1000) + 900;
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({
      data: [{ id: "1", name: "Ada Lovelace", username: "ada" }],
      errors: [{ value: "2", title: "Not Found Error" }],
    }), {
      status: 200,
      headers: {
        "content-type": "application/json",
        "x-rate-limit-limit": "300",
        "x-rate-limit-remaining": "299",
        "x-rate-limit-reset": String(reset),
      },
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(getUsersByIds(accountId, ["1", "2"])).resolves.toEqual({
      users: [{ id: "1", name: "Ada Lovelace", username: "ada" }],
      errors: [{ value: "2", title: "Not Found Error" }],
    });

    const requestedUrl = String(fetchMock.mock.calls[0]?.[0]);
    expect(requestedUrl).toContain("/2/users?");
    expect(requestedUrl).toContain("ids=1%2C2");
    expect(requestedUrl).toContain("user.fields=name%2Cusername%2Cdescription");
    const rateState = JSON.parse(getPlatformAccountById(accountId)?.rateLimitState ?? "{}") as Record<string, unknown>;
    expect(rateState).toHaveProperty("/users");
  });

  it("rejects requests over the X batch limit", async () => {
    const ids = Array.from({ length: X_USER_LOOKUP_MAX_IDS + 1 }, (_, index) => String(index));
    await expect(getUsersByIds("unused", ids)).rejects.toThrow("at most 100 IDs");
  });

  it("maps 429 responses to RateLimitError", async () => {
    const accountId = seedAccount();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", {
      status: 429,
      headers: { "x-rate-limit-reset": String(Math.floor(Date.now() / 1000) + 60) },
    })));
    await expect(getUsersByIds(accountId, ["1"])).rejects.toBeInstanceOf(RateLimitError);
  });

  it("maps 403 responses to TierRestrictedError", async () => {
    const accountId = seedAccount();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ detail: "Upgrade required" }), {
      status: 403,
      headers: { "content-type": "application/json" },
    })));
    await expect(getUsersByIds(accountId, ["1"])).rejects.toBeInstanceOf(TierRestrictedError);
  });
});

describe("getUsersByUsernames", () => {
  beforeEach(() => {
    resetCoreTables();
    db.delete(platformAccounts).run();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("looks handle-keyed identities up through /users/by and returns per-handle errors", async () => {
    const accountId = seedAccount();
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({
      data: [{ id: "1605", name: "Sam", username: "sama" }],
      errors: [{ value: "ghost_handle", title: "Not Found Error" }],
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(getUsersByUsernames(accountId, ["sama", "ghost_handle"])).resolves.toEqual({
      users: [{ id: "1605", name: "Sam", username: "sama" }],
      errors: [{ value: "ghost_handle", title: "Not Found Error" }],
    });
    const requestedUrl = String(fetchMock.mock.calls[0]?.[0]);
    expect(requestedUrl).toContain("/users/by?");
    expect(new URL(requestedUrl).searchParams.get("usernames")).toBe("sama,ghost_handle");
  });

  it("short-circuits on no handles and refuses oversized batches", async () => {
    const accountId = seedAccount();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(getUsersByUsernames(accountId, [])).resolves.toEqual({ users: [], errors: [] });
    await expect(
      getUsersByUsernames(
        accountId,
        Array.from({ length: X_USER_LOOKUP_MAX_USERNAMES + 1 }, (_, index) => `handle${index}`),
      ),
    ).rejects.toThrow(/at most 100 usernames/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
