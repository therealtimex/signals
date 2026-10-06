import { NextRequest, NextResponse } from "next/server";
import { denyExternalEffect } from "@/lib/instance/guard";
import { randomBytes } from "crypto";
import { getLinkedInClientCredentials } from "@/lib/platforms/linkedin/auth";
import { saveLinkedInOAuthState } from "@/lib/platforms/linkedin/oauth-state-store";

// LinkedIn OAuth scopes — basic profile + email + connections
const SCOPES = "openid profile email r_connections";

/**
 * GET /api/platforms/linkedin/auth
 * Generate LinkedIn OAuth 2.0 authorization URL.
 */
export async function GET(req: NextRequest) {
  // ADR-541-5: a Dev instance never connects a real account.
  const denied = denyExternalEffect("oauth.connect");
  if (denied) return denied;

  try {
    const { clientId } = getLinkedInClientCredentials();

    // Determine redirect URI from the request origin
    const origin = req.headers.get("origin") || req.nextUrl.origin;
    const redirectUri = `${origin}/api/platforms/linkedin/callback`;

    // Generate state parameter for CSRF protection
    const state = randomBytes(16).toString("hex");
    saveLinkedInOAuthState(state);

    const params = new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      redirect_uri: redirectUri,
      scope: SCOPES,
      state,
    });

    const authUrl = `https://www.linkedin.com/oauth/v2/authorization?${params.toString()}`;

    return NextResponse.json({ authUrl, state });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to generate auth URL";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
