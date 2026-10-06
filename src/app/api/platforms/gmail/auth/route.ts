import { NextRequest, NextResponse } from "next/server";
import { denyExternalEffect } from "@/lib/instance/guard";
import { randomBytes } from "crypto";
import { getGoogleClientCredentials } from "@/lib/platforms/gmail/auth";
import { saveGmailOAuthState } from "@/lib/platforms/gmail/oauth-state-store";

// Google OAuth scopes — OpenID Connect (for userinfo) + read-only contacts + Gmail read
// Note: gmail.readonly is required (not gmail.metadata) because messages.list `q` parameter
// is only supported with gmail.readonly or higher scopes.
const SCOPES = [
  "openid",
  "profile",
  "email",
  "https://www.googleapis.com/auth/contacts.readonly",
  "https://www.googleapis.com/auth/gmail.readonly",
].join(" ");

/**
 * GET /api/platforms/gmail/auth
 * Generate Google OAuth 2.0 authorization URL.
 */
export async function GET(req: NextRequest) {
  // ADR-541-5: a Dev instance never connects a real account.
  const denied = denyExternalEffect("oauth.connect");
  if (denied) return denied;

  try {
    const { clientId } = getGoogleClientCredentials();

    // Determine redirect URI from the request origin
    const origin = req.headers.get("origin") || req.nextUrl.origin;
    const redirectUri = `${origin}/api/platforms/gmail/callback`;

    // Generate state parameter for CSRF protection
    const state = randomBytes(16).toString("hex");
    saveGmailOAuthState(state);

    const params = new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      redirect_uri: redirectUri,
      scope: SCOPES,
      state,
      access_type: "offline",
      prompt: "consent",
    });

    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;

    return NextResponse.json({ authUrl, state });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to generate auth URL";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
