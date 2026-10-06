import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nanoid } from "nanoid";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/platforms/x/engage/route";
import { encrypt } from "@/lib/auth/crypto";
import { db } from "@/lib/db/client";
import { platformAccounts } from "@/lib/db/schema";
import { resetCoreTables } from "@/test/db";

function seedConnectedXAccount() {
  db.insert(platformAccounts).values({
    id: nanoid(),
    platform: "x",
    displayName: "@owner",
    authType: "oauth",
    status: "active",
    credentialsEncrypted: encrypt(JSON.stringify({
      accessToken: "token",
      refreshToken: "refresh",
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
    })),
  }).run();
}

function engage(body: unknown) {
  return POST(
    new NextRequest("http://localhost/api/platforms/x/engage", {
      method: "POST",
      body: JSON.stringify(body),
    })
  );
}

describe("POST /api/platforms/x/engage", () => {
  beforeEach(() => {
    resetCoreTables();
    db.delete(platformAccounts).run();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("refuses on a Dev instance with 403 DEV_INSTANCE_GUARD and no X call", async () => {
    vi.stubEnv("SIGNALS_INSTANCE", "dev");
    seedConnectedXAccount();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const res = await engage({ action: "like", tweetId: "t1" });

    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({
      success: false,
      code: "DEV_INSTANCE_GUARD",
      effect: "engage.x-api",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("engages unchanged on a canonical instance", async () => {
    seedConnectedXAccount();
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = String(input);
      const data = url.includes("/likes") ? { liked: true } : { id: "u1", name: "Owner", username: "owner" };
      return new Response(JSON.stringify({ data }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const res = await engage({ action: "like", tweetId: "t1" });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true, action: "like", result: { liked: true } });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
