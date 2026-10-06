import { NextRequest, NextResponse } from "next/server";
import { denyExternalEffect } from "@/lib/instance/guard";
import { randomBytes, createHash } from "crypto";
import { getXClientCredentials } from "@/lib/platforms/x/auth";
import { savePkceState } from "@/lib/platforms/x/pkce-store";

// Free tier: CRM engagement + messaging (requires "Read and write and Direct message" in X Developer Portal)
const FREE_SCOPES = "tweet.read tweet.write tweet.moderate.write users.read like.read like.write bookmark.read bookmark.write dm.read dm.write offline.access";
// Basic+ tier: adds contact management scopes (follows, lists, mute, block)
const EXTENDED_SCOPES = "tweet.read tweet.write tweet.moderate.write users.read like.read like.write bookmark.read bookmark.write dm.read dm.write follows.read follows.write list.read list.write mute.read mute.write block.read block.write space.read offline.access";

/**
 * GET /api/platforms/x/auth
 * Generate PKCE challenge and return the X OAuth 2.0 authorization URL.
 * Pass ?extended=true to request Basic+ tier scopes (follows.read/write).
 */
export async function GET(req: NextRequest) {
  // ADR-541-5: a Dev instance never connects a real account.
  const denied = denyExternalEffect("oauth.connect");
  if (denied) return denied;

  try {
    const { clientId } = getXClientCredentials();
    const extended = req.nextUrl.searchParams.get("extended") === "true";

    // Determine redirect URI from the request origin
    const origin = req.headers.get("origin") || req.nextUrl.origin;
    const redirectUri = `${origin}/api/platforms/x/callback`;

    // Generate PKCE code verifier and challenge
    const codeVerifier = randomBytes(32).toString("base64url");
    const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");

    // Generate state parameter for CSRF protection
    const state = randomBytes(16).toString("hex");

    // Store PKCE state with tier metadata (in-memory, 10-min TTL)
    savePkceState(state, codeVerifier, extended);

    const params = new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      redirect_uri: redirectUri,
      scope: extended ? EXTENDED_SCOPES : FREE_SCOPES,
      state,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
    });

    const authUrl = `https://x.com/i/oauth2/authorize?${params.toString()}`;

    return NextResponse.json({ authUrl, state });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to generate auth URL";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
