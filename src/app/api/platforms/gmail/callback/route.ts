import { NextRequest, NextResponse } from "next/server";
import { getGoogleClientCredentials } from "@/lib/platforms/gmail/auth";
import { validateGmailOAuthState } from "@/lib/platforms/gmail/oauth-state-store";
import { encrypt } from "@/lib/auth/crypto";
import {
  createPlatformAccount,
  updatePlatformAccount,
} from "@/lib/db/queries/platform-accounts";
import { getLegacyGmailOAuthAccount } from "@/lib/db/queries/mail-accounts";
import type { PlatformCredentials } from "@/lib/platforms/adapter";

/**
 * GET /api/platforms/gmail/callback?code=...&state=...
 * OAuth 2.0 callback — exchanges code for tokens, fetches profile, stores account.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const error = searchParams.get("error");

  // Handle OAuth denial
  if (error) {
    return NextResponse.redirect(
      new URL(`/dashboard/settings?error=${encodeURIComponent(error)}`, req.url)
    );
  }

  if (!code || !state) {
    return NextResponse.redirect(
      new URL("/dashboard/settings?error=missing_params", req.url)
    );
  }

  // Validate CSRF state
  const validState = validateGmailOAuthState(state);
  if (!validState) {
    return NextResponse.redirect(
      new URL("/dashboard/settings?error=invalid_state", req.url)
    );
  }

  try {
    const { clientId, clientSecret } = getGoogleClientCredentials();
    const origin = req.nextUrl.origin;
    const redirectUri = `${origin}/api/platforms/gmail/callback`;

    // Exchange authorization code for tokens
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
        client_id: clientId,
        client_secret: clientSecret,
      }),
    });

    if (!tokenRes.ok) {
      const errText = await tokenRes.text();
      console.error("Google token exchange failed:", errText);
      return NextResponse.redirect(
        new URL("/dashboard/settings?error=token_exchange_failed", req.url)
      );
    }

    const tokenData = await tokenRes.json();
    const creds: PlatformCredentials = {
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token ?? "",
      expiresAt: Math.floor(Date.now() / 1000) + (tokenData.expires_in ?? 3600),
      // Google returns scope space-separated (no normalization needed, unlike LinkedIn's comma-separated)
      grantedScopes: tokenData.scope ?? "",
    };

    // Fetch user profile from Google userinfo endpoint
    const profileRes = await fetch(
      "https://www.googleapis.com/oauth2/v3/userinfo",
      {
        headers: { Authorization: `Bearer ${creds.accessToken}` },
      }
    );

    if (!profileRes.ok) {
      const errText = await profileRes.text();
      console.error("Google profile fetch failed:", errText);
      return NextResponse.redirect(
        new URL("/dashboard/settings?error=profile_fetch_failed", req.url)
      );
    }

    const userinfo = await profileRes.json();
    const displayName = userinfo.name ?? `${userinfo.given_name ?? ""} ${userinfo.family_name ?? ""}`.trim();

    // Upsert platform account
    const existing = getLegacyGmailOAuthAccount();
    if (existing) {
      updatePlatformAccount(existing.id, {
        displayName: displayName || userinfo.email || "Gmail User",
        credentialsEncrypted: encrypt(JSON.stringify(creds)),
        status: "active",
      });
    } else {
      createPlatformAccount({
        platform: "gmail",
        displayName: displayName || userinfo.email || "Gmail User",
        authType: "oauth",
        credentialsEncrypted: encrypt(JSON.stringify(creds)),
        status: "active",
      });
    }

    return NextResponse.redirect(
      new URL("/dashboard/settings?connected=gmail", req.url)
    );
  } catch (err) {
    console.error("Google OAuth callback error:", err);
    return NextResponse.redirect(
      new URL("/dashboard/settings?error=callback_failed", req.url)
    );
  }
}
