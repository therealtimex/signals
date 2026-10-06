import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET as gmailAuth } from "@/app/api/platforms/gmail/auth/route";
import { GET as gmailCallback } from "@/app/api/platforms/gmail/callback/route";
import { GET as linkedinAuth } from "@/app/api/platforms/linkedin/auth/route";
import { GET as linkedinCallback } from "@/app/api/platforms/linkedin/callback/route";
import { GET as xAuth } from "@/app/api/platforms/x/auth/route";
import { GET as xCallback } from "@/app/api/platforms/x/callback/route";
import { db } from "@/lib/db/client";
import { platformAccounts } from "@/lib/db/schema";
import { resetCoreTables } from "@/test/db";

const handlers = [
  ["x/auth", xAuth],
  ["x/callback", xCallback],
  ["linkedin/auth", linkedinAuth],
  ["linkedin/callback", linkedinCallback],
  ["gmail/auth", gmailAuth],
  ["gmail/callback", gmailCallback],
] as const;

function oauthRequest(path: string) {
  // A callback carrying a code and state is the request that would exchange tokens.
  return new NextRequest(`http://localhost:3000/api/platforms/${path}?code=abc&state=def`);
}

describe("OAuth connect routes (ADR-541-5)", () => {
  beforeEach(() => {
    resetCoreTables();
    db.delete(platformAccounts).run();
    // Client credentials present, so a canonical auth route would build a real authorize URL.
    vi.stubEnv("X_CLIENT_ID", "x-client");
    vi.stubEnv("X_CLIENT_SECRET", "x-secret");
    vi.stubEnv("LINKEDIN_CLIENT_ID", "li-client");
    vi.stubEnv("LINKEDIN_CLIENT_SECRET", "li-secret");
    vi.stubEnv("GOOGLE_CLIENT_ID", "g-client");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "g-secret");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it.each(handlers)(
    "%s answers 403 DEV_INSTANCE_GUARD on a Dev instance with no outbound call or account row",
    async (path, handler) => {
      vi.stubEnv("SIGNALS_INSTANCE", "dev");
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);

      const response = await handler(oauthRequest(path));

      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({
        success: false,
        code: "DEV_INSTANCE_GUARD",
        effect: "oauth.connect",
        error: expect.stringContaining("SIGNALS_INSTANCE=dev"),
      });
      expect(fetchMock).not.toHaveBeenCalled();
      expect(db.select().from(platformAccounts).all()).toHaveLength(0);
    },
  );

  it.each(handlers)("%s is not refused on a canonical instance", async (path, handler) => {
    // No outbound call is reachable here: an unknown state stops every callback before the
    // token exchange, and auth routes only build a URL.
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await handler(oauthRequest(path));

    expect(response.status).not.toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
