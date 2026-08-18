"use client";

import { useState, useEffect, Suspense, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CheckCircle } from "lucide-react";
import type { ConnectionStatus } from "@/components/platform-connection-card";
import { SocialPlatformCard } from "@/components/social-platform-card";
import { ComingSoonPlatformCards } from "@/components/coming-soon-platform-cards";
import { HimalayaMailAccountsSection } from "@/components/himalaya-mail-accounts-section";

type PlatformPayload = {
  connected: boolean;
  oauthConnected?: boolean;
  connectionVia: "browser" | "oauth" | null;
  hasBrowserSession: boolean;
  account?: {
    displayName: string | null;
    status: "active" | "paused" | "needs_reauth" | null;
    grantedScopes?: string;
    syncCapable?: boolean;
  } | null;
};

type SessionPayload = {
  hasSession: boolean;
  lastValidatedAt: number | null;
  detectedHandle: string | null;
};

type PlatformUiState = {
  loading: boolean;
  payload: PlatformPayload | null;
  session: SessionPayload | null;
};

const EMPTY_PLATFORM: PlatformUiState = {
  loading: true,
  payload: null,
  session: null,
};

function oauthStatus(payload: PlatformPayload | null): ConnectionStatus {
  if (!payload?.oauthConnected) return "disconnected";
  if (payload.account?.status === "needs_reauth") return "needs_reauth";
  return "connected";
}

function oauthConnected(payload: PlatformPayload | null): boolean {
  return !!payload?.oauthConnected;
}

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export default function SettingsPage() {
  return (
    <Suspense>
      <SettingsContent />
    </Suspense>
  );
}

function SettingsContent() {
  const searchParams = useSearchParams();
  const [rtxEmbedded, setRtxEmbedded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const [xState, setXState] = useState<PlatformUiState>(EMPTY_PLATFORM);
  const [liState, setLiState] = useState<PlatformUiState>(EMPTY_PLATFORM);

  const [xOpening, setXOpening] = useState(false);
  const [xValidating, setXValidating] = useState(false);
  const [xDisconnecting, setXDisconnecting] = useState(false);
  const [xOAuthConnecting, setXOAuthConnecting] = useState(false);
  const [xOAuthDisconnecting, setXOAuthDisconnecting] = useState(false);

  const [liOpening, setLiOpening] = useState(false);
  const [liValidating, setLiValidating] = useState(false);
  const [liDisconnecting, setLiDisconnecting] = useState(false);
  const [liOAuthConnecting, setLiOAuthConnecting] = useState(false);
  const [liOAuthDisconnecting, setLiOAuthDisconnecting] = useState(false);

  const fetchPlatform = useCallback(async (platform: "x" | "linkedin") => {
    const [platformRes, sessionRes] = await Promise.all([
      fetchJson<PlatformPayload>(`/api/platforms/${platform}`),
      fetchJson<SessionPayload>(`/api/platforms/${platform}/browser-session`),
    ]);

    return {
      payload: platformRes,
      session: sessionRes,
    };
  }, []);

  const refreshX = useCallback(async () => {
    const data = await fetchPlatform("x");
    setXState({ loading: false, ...data });
  }, [fetchPlatform]);

  const refreshLinkedIn = useCallback(async () => {
    const data = await fetchPlatform("linkedin");
    setLiState({ loading: false, ...data });
  }, [fetchPlatform]);

  const refreshAll = useCallback(async () => {
    await Promise.all([refreshX(), refreshLinkedIn()]);
  }, [refreshX, refreshLinkedIn]);

  useEffect(() => {
    fetchJson<{ rtx?: { mode?: string } }>("/api/health").then((data) => {
      setRtxEmbedded(data?.rtx?.mode === "embedded");
    });

    refreshAll();
  }, [refreshAll]);

  useEffect(() => {
    const connected = searchParams.get("connected");
    const oauthError = searchParams.get("error");

    if (connected === "x") {
      setSuccessMessage("X OAuth connected successfully!");
      refreshX();
      window.history.replaceState({}, "", "/dashboard/settings");
    } else if (connected === "linkedin") {
      setSuccessMessage("LinkedIn OAuth connected successfully!");
      refreshLinkedIn();
      window.history.replaceState({}, "", "/dashboard/settings");
    } else if (oauthError) {
      setError(`OAuth error: ${oauthError}`);
      window.history.replaceState({}, "", "/dashboard/settings");
    }
  }, [searchParams, refreshX, refreshLinkedIn]);

  async function runSessionAction(
    platform: "x" | "linkedin",
    action: "setup" | "validate" | "disconnect"
  ) {
    const setOpening = platform === "x" ? setXOpening : setLiOpening;
    const setValidating = platform === "x" ? setXValidating : setLiValidating;
    const setDisconnecting = platform === "x" ? setXDisconnecting : setLiDisconnecting;
    const refresh = platform === "x" ? refreshX : refreshLinkedIn;

    setError(null);
    if (action === "setup") setOpening(true);
    if (action === "validate") setValidating(true);
    if (action === "disconnect") setDisconnecting(true);

    try {
      if (action === "disconnect") {
        const res = await fetch(`/api/platforms/${platform}/browser-session`, { method: "DELETE" });
        if (!res.ok) {
          const data = await res.json();
          setError(data.error || "Failed to disconnect browser session");
          return;
        }
        setSuccessMessage(`${platform === "x" ? "X" : "LinkedIn"} browser session disconnected.`);
        await refresh();
        return;
      }

      const res = await fetch(`/api/platforms/${platform}/browser-session`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: action === "setup" ? "setup" : "validate" }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Browser session operation failed");
        return;
      }

      if (action === "validate") {
        if (data.isValid) {
          setSuccessMessage(
            `${platform === "x" ? "X" : "LinkedIn"} session validated${
              data.detectedHandle ? ` as ${data.detectedHandle}` : ""
            }.`
          );
        } else {
          setError("Session is not logged in. Open the RealTimeX Browser window and sign in, then validate again.");
        }
      } else {
        setSuccessMessage(
          `RealTimeX Browser opened — sign in to ${platform === "x" ? "X" : "LinkedIn"}, then click Validate.`
        );
      }
      await refresh();
    } catch {
      setError("Browser session operation failed");
    } finally {
      setOpening(false);
      setValidating(false);
      setDisconnecting(false);
    }
  }

  async function handleOAuthConnect(platform: "x" | "linkedin", extended = false) {
    const setConnecting = platform === "x" ? setXOAuthConnecting : setLiOAuthConnecting;
    setConnecting(true);
    setError(null);

    try {
      const url =
        platform === "x"
          ? extended
            ? "/api/platforms/x/auth?extended=true"
            : "/api/platforms/x/auth"
          : "/api/platforms/linkedin/auth";
      const res = await fetch(url);
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to start OAuth flow");
        return;
      }
      window.location.href = data.authUrl;
    } catch {
      setError(`Failed to connect to ${platform === "x" ? "X" : "LinkedIn"}`);
    } finally {
      setConnecting(false);
    }
  }

  async function handleOAuthDisconnect(platform: "x" | "linkedin") {
    const setDisconnecting = platform === "x" ? setXOAuthDisconnecting : setLiOAuthDisconnecting;
    const refresh = platform === "x" ? refreshX : refreshLinkedIn;
    setDisconnecting(true);
    setError(null);

    try {
      const res = await fetch(`/api/platforms/${platform}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Failed to disconnect OAuth");
        return;
      }
      setSuccessMessage(`${platform === "x" ? "X" : "LinkedIn"} OAuth disconnected.`);
      await refresh();
    } catch {
      setError("Failed to disconnect OAuth");
    } finally {
      setDisconnecting(false);
    }
  }

  const xPayload = xState.payload;
  const liPayload = liState.payload;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-heading-1">Settings</h1>
        <p className="text-muted-foreground mt-1">
          Connect platforms via RealTimeX Browser. OAuth API sync is optional.
        </p>
      </div>

      {rtxEmbedded && (
        <div className="rounded-lg border bg-muted/40 p-4 text-sm text-muted-foreground">
          AI chat, embeddings, and search are provided by RealtimeX. Configure models and approve{" "}
          <code className="rounded bg-muted px-1 py-0.5 text-xs">llm.chat</code> and{" "}
          <code className="rounded bg-muted px-1 py-0.5 text-xs">llm.embed</code> in RealtimeX{" "}
          <strong className="font-medium text-foreground">Settings → Local Apps</strong>.
        </div>
      )}

      {successMessage && (
        <div className="rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-800 dark:border-green-800 dark:bg-green-950 dark:text-green-200">
          <div className="flex items-center gap-2">
            <CheckCircle className="h-4 w-4" />
            {successMessage}
          </div>
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
          {error}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Platform Connections</CardTitle>
          <CardDescription>
            One connection per platform via RealTimeX Browser session. Publish and file-based imports
            work without OAuth.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <SocialPlatformCard
            platform="x"
            displayName="X / Twitter"
            loading={xState.loading}
            rtxEmbedded={rtxEmbedded}
            connected={!!xPayload?.connected}
            connectionVia={xPayload?.connectionVia ?? null}
            accountHandle={
              xState.session?.detectedHandle ?? xPayload?.account?.displayName ?? null
            }
            lastValidatedAt={xState.session?.lastValidatedAt ?? null}
            hasBrowserSession={!!xState.session?.hasSession || !!xPayload?.hasBrowserSession}
            oauthConnected={oauthConnected(xPayload)}
            oauthStatus={oauthStatus(xPayload)}
            grantedScopes={xPayload?.account?.grantedScopes}
            syncCapable={xPayload?.account?.syncCapable}
            dataHint="Import X archive (Automation)"
            publishHint="agent lane (signals-publish)"
            onOpenSession={() => runSessionAction("x", "setup")}
            onValidate={() => runSessionAction("x", "validate")}
            onDisconnectBrowser={() => runSessionAction("x", "disconnect")}
            onOAuthConnect={() => handleOAuthConnect("x", false)}
            onOAuthDisconnect={() => handleOAuthDisconnect("x")}
            onEnableOAuthSync={() => handleOAuthConnect("x", true)}
            opening={xOpening}
            validating={xValidating}
            disconnectingBrowser={xDisconnecting}
            oauthConnecting={xOAuthConnecting}
            oauthDisconnecting={xOAuthDisconnecting}
          />

          <SocialPlatformCard
            platform="linkedin"
            displayName="LinkedIn"
            loading={liState.loading}
            rtxEmbedded={rtxEmbedded}
            connected={!!liPayload?.connected}
            connectionVia={liPayload?.connectionVia ?? null}
            accountHandle={
              liState.session?.detectedHandle ?? liPayload?.account?.displayName ?? null
            }
            lastValidatedAt={liState.session?.lastValidatedAt ?? null}
            hasBrowserSession={!!liState.session?.hasSession || !!liPayload?.hasBrowserSession}
            oauthConnected={oauthConnected(liPayload)}
            oauthStatus={oauthStatus(liPayload)}
            grantedScopes={liPayload?.account?.grantedScopes}
            syncCapable={liPayload?.account?.syncCapable}
            dataHint="Import Connections zip (Automation)"
            publishHint="agent lane (beta)"
            onOpenSession={() => runSessionAction("linkedin", "setup")}
            onValidate={() => runSessionAction("linkedin", "validate")}
            onDisconnectBrowser={() => runSessionAction("linkedin", "disconnect")}
            onOAuthConnect={() => handleOAuthConnect("linkedin")}
            onOAuthDisconnect={() => handleOAuthDisconnect("linkedin")}
            opening={liOpening}
            validating={liValidating}
            disconnectingBrowser={liDisconnecting}
            oauthConnecting={liOAuthConnecting}
            oauthDisconnecting={liOAuthDisconnecting}
          />

          <HimalayaMailAccountsSection />
          <ComingSoonPlatformCards />
        </CardContent>
      </Card>
    </div>
  );
}
