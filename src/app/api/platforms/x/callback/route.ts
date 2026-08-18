import { NextRequest, NextResponse } from "next/server";
import { getXClientCredentials, saveXCredentials } from "@/lib/platforms/x/auth";
import { getPkceState } from "@/lib/platforms/x/pkce-store";
import { encrypt } from "@/lib/auth/crypto";
import {
  createPlatformAccount,
  getPlatformAccountByPlatform,
  updatePlatformAccount,
} from "@/lib/db/queries/platform-accounts";
import type { PlatformCredentials } from "@/lib/platforms/adapter";

/**
 * GET /api/platforms/x/callback?code=...&state=...
 * OAuth 2.0 callback — exchanges code for tokens, fetches user profile, stores account.
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

  // Validate PKCE state
  const pkceEntry = getPkceState(state);
  if (!pkceEntry) {
    return NextResponse.redirect(
      new URL("/dashboard/settings?error=invalid_state", req.url)
    );
  }
  const { codeVerifier } = pkceEntry;

  try {
    const { clientId, clientSecret } = getXClientCredentials();
    const origin = req.nextUrl.origin;
    const redirectUri = `${origin}/api/platforms/x/callback`;

    // Exchange authorization code for tokens
    const tokenRes = await fetch("https://api.x.com/2/oauth2/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
        code_verifier: codeVerifier,
      }),
    });

    if (!tokenRes.ok) {
      const errText = await tokenRes.text();
      console.error("Token exchange failed:", errText);
      return NextResponse.redirect(
        new URL("/dashboard/settings?error=token_exchange_failed", req.url)
      );
    }

    const tokenData = await tokenRes.json();
    // X returns the actually-granted scopes in the token response
    const grantedScopes: string = tokenData.scope ?? "";
    const creds: PlatformCredentials = {
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      expiresAt: Math.floor(Date.now() / 1000) + tokenData.expires_in,
      grantedScopes,
    };

    // Fetch user profile from X API
    const profileRes = await fetch(
      "https://api.x.com/2/users/me?user.fields=name,username,description,location,url,profile_image_url,public_metrics",
      {
        headers: { Authorization: `Bearer ${creds.accessToken}` },
      }
    );

    if (!profileRes.ok) {
      const errText = await profileRes.text();
      console.error("Profile fetch failed:", errText);
      return NextResponse.redirect(
        new URL("/dashboard/settings?error=profile_fetch_failed", req.url)
      );
    }

    const profileData = await profileRes.json();
    const xUser = profileData.data;

    // Upsert platform account
    const existing = getPlatformAccountByPlatform("x");
    if (existing) {
      // Upgrades archive-import placeholder accounts (authType "session",
      // no credentials) in place, keeping imported content attached.
      updatePlatformAccount(existing.id, {
        displayName: `@${xUser.username}`,
        authType: "oauth",
        credentialsEncrypted: encrypt(JSON.stringify(creds)),
        status: "active",
      });
    } else {
      const account = createPlatformAccount({
        platform: "x",
        displayName: `@${xUser.username}`,
        authType: "oauth",
        credentialsEncrypted: encrypt(JSON.stringify(creds)),
        status: "active",
      });
      // Save credentials after creation (already encrypted in createPlatformAccount call above)
      void account; // credentials already stored inline
    }

    return NextResponse.redirect(
      new URL("/dashboard/settings?connected=x", req.url)
    );
  } catch (err) {
    console.error("OAuth callback error:", err);
    return NextResponse.redirect(
      new URL("/dashboard/settings?error=callback_failed", req.url)
    );
  }
}
