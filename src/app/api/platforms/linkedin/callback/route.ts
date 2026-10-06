import { NextRequest, NextResponse } from "next/server";
import { denyExternalEffect } from "@/lib/instance/guard";
import { getLinkedInClientCredentials } from "@/lib/platforms/linkedin/auth";
import { validateLinkedInOAuthState } from "@/lib/platforms/linkedin/oauth-state-store";
import { encrypt } from "@/lib/auth/crypto";
import {
  createPlatformAccount,
  getPlatformAccountByPlatform,
  updatePlatformAccount,
} from "@/lib/db/queries/platform-accounts";
import type { PlatformCredentials } from "@/lib/platforms/adapter";

/**
 * GET /api/platforms/linkedin/callback?code=...&state=...
 * OAuth 2.0 callback — exchanges code for tokens, fetches profile+email, stores account.
 */
export async function GET(req: NextRequest) {
  // ADR-541-5: a Dev instance never connects a real account.
  const denied = denyExternalEffect("oauth.connect");
  if (denied) return denied;

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
  const validState = validateLinkedInOAuthState(state);
  if (!validState) {
    return NextResponse.redirect(
      new URL("/dashboard/settings?error=invalid_state", req.url)
    );
  }

  try {
    const { clientId, clientSecret } = getLinkedInClientCredentials();
    const origin = req.nextUrl.origin;
    const redirectUri = `${origin}/api/platforms/linkedin/callback`;

    // Exchange authorization code for tokens
    // LinkedIn sends client_id/client_secret as POST body params (NOT Basic auth header)
    const tokenRes = await fetch("https://www.linkedin.com/oauth/v2/accessToken", {
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
      console.error("LinkedIn token exchange failed:", errText);
      return NextResponse.redirect(
        new URL("/dashboard/settings?error=token_exchange_failed", req.url)
      );
    }

    const tokenData = await tokenRes.json();
    const creds: PlatformCredentials = {
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token ?? "",
      expiresAt: Math.floor(Date.now() / 1000) + (tokenData.expires_in ?? 5184000), // default 60 days
      grantedScopes: (tokenData.scope ?? "").replace(/,/g, " "),
    };

    // Fetch user profile from LinkedIn userinfo endpoint (OpenID Connect)
    // The /v2/userinfo endpoint works with openid+profile+email scopes
    // (the older /v2/me endpoint requires the deprecated r_liteprofile scope)
    const profileRes = await fetch(
      "https://api.linkedin.com/v2/userinfo",
      {
        headers: { Authorization: `Bearer ${creds.accessToken}` },
      }
    );

    if (!profileRes.ok) {
      const errText = await profileRes.text();
      console.error("LinkedIn profile fetch failed:", errText);
      return NextResponse.redirect(
        new URL("/dashboard/settings?error=profile_fetch_failed", req.url)
      );
    }

    const userinfo = await profileRes.json();
    const displayName = userinfo.name ?? `${userinfo.given_name ?? ""} ${userinfo.family_name ?? ""}`.trim();

    // Upsert platform account
    const existing = getPlatformAccountByPlatform("linkedin");
    if (existing) {
      updatePlatformAccount(existing.id, {
        displayName,
        credentialsEncrypted: encrypt(JSON.stringify(creds)),
        status: "active",
      });
    } else {
      createPlatformAccount({
        platform: "linkedin",
        displayName,
        authType: "oauth",
        credentialsEncrypted: encrypt(JSON.stringify(creds)),
        status: "active",
      });
    }

    return NextResponse.redirect(
      new URL("/dashboard/settings?connected=linkedin", req.url)
    );
  } catch (err) {
    console.error("LinkedIn OAuth callback error:", err);
    return NextResponse.redirect(
      new URL("/dashboard/settings?error=callback_failed", req.url)
    );
  }
}
