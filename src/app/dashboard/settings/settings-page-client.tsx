"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CheckCircle } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { ConnectionStatus } from "@/components/platform-connection-card";
import { AiAgentsTab } from "@/app/dashboard/settings/ai-agents-tab";
import {
  PlatformsTab,
  type PlatformKey,
  type PlatformPayload,
  type PlatformUiState,
  type SessionPayload,
} from "@/app/dashboard/settings/platforms-tab";
import {
  navigateSettingsTab,
  parseSettingsTab,
  settingsTabHref,
} from "@/app/dashboard/settings/settings-tabs";

const EMPTY_PLATFORM: PlatformUiState = {
  loading: true,
  payload: null,
  session: null,
};

const PLATFORM_LABELS: Record<PlatformKey, string> = {
  x: "X",
  linkedin: "LinkedIn",
  facebook: "Facebook",
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

export function SettingsPageClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeTab = parseSettingsTab(searchParams.get("tab"));

  const [rtxEmbedded, setRtxEmbedded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const [xState, setXState] = useState<PlatformUiState>(EMPTY_PLATFORM);
  const [liState, setLiState] = useState<PlatformUiState>(EMPTY_PLATFORM);
  const [fbState, setFbState] = useState<PlatformUiState>(EMPTY_PLATFORM);

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

  const [fbOpening, setFbOpening] = useState(false);
  const [fbValidating, setFbValidating] = useState(false);
  const [fbDisconnecting, setFbDisconnecting] = useState(false);
  const [targetActions, setTargetActions] = useState<Partial<Record<PlatformKey, string>>>({});

  const fetchPlatform = useCallback(async (platform: PlatformKey) => {
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

  const refreshFacebook = useCallback(async () => {
    const data = await fetchPlatform("facebook");
    setFbState({ loading: false, ...data });
  }, [fetchPlatform]);

  const refreshAll = useCallback(async () => {
    await Promise.all([refreshX(), refreshLinkedIn(), refreshFacebook()]);
  }, [refreshX, refreshLinkedIn, refreshFacebook]);

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
      window.history.replaceState({}, "", settingsTabHref("platforms"));
    } else if (connected === "linkedin") {
      setSuccessMessage("LinkedIn OAuth connected successfully!");
      refreshLinkedIn();
      window.history.replaceState({}, "", settingsTabHref("platforms"));
    } else if (oauthError) {
      setError(`OAuth error: ${oauthError}`);
      window.history.replaceState({}, "", settingsTabHref("platforms"));
    }
  }, [searchParams, refreshX, refreshLinkedIn]);

  function handleTabChange(nextTab: string) {
    navigateSettingsTab(router.replace, parseSettingsTab(nextTab));
  }

  async function runSessionAction(platform: PlatformKey, action: "setup" | "validate" | "disconnect") {
    const stateSetters = {
      x: { opening: setXOpening, validating: setXValidating, disconnecting: setXDisconnecting, refresh: refreshX },
      linkedin: {
        opening: setLiOpening,
        validating: setLiValidating,
        disconnecting: setLiDisconnecting,
        refresh: refreshLinkedIn,
      },
      facebook: {
        opening: setFbOpening,
        validating: setFbValidating,
        disconnecting: setFbDisconnecting,
        refresh: refreshFacebook,
      },
    }[platform];
    const { opening: setOpening, validating: setValidating, disconnecting: setDisconnecting, refresh } =
      stateSetters;

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
        setSuccessMessage(`${PLATFORM_LABELS[platform]} browser session disconnected.`);
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
            `${PLATFORM_LABELS[platform]} session validated${
              data.detectedHandle ? ` as ${data.detectedHandle}` : ""
            }.`,
          );
        } else {
          setError("Session is not logged in. Open the RealTimeX Browser window and sign in, then validate again.");
        }
      } else {
        setSuccessMessage(
          `RealTimeX Browser opened — sign in to ${PLATFORM_LABELS[platform]}, then click Validate.`,
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

  async function runTargetAction(
    platform: PlatformKey,
    action: "add" | "discover" | "default" | "verify" | "forget",
    targetId?: string,
  ) {
    setTargetActions((current) => ({ ...current, [platform]: targetId ?? action }));
    setError(null);
    try {
      const request =
        action === "add"
          ? { url: "/api/platform-targets/register-current", method: "POST", body: { platform } }
          : action === "discover"
            ? { url: "/api/platform-targets/discover", method: "POST", body: { platform } }
            : action === "default"
              ? { url: `/api/platform-targets/${targetId}/default`, method: "POST" }
              : action === "verify"
                ? { url: `/api/platform-targets/${targetId}/verify`, method: "POST" }
                : { url: `/api/platform-targets/${targetId}`, method: "DELETE" };
      const response = await fetch(request.url, {
        method: request.method,
        headers: request.body ? { "Content-Type": "application/json" } : undefined,
        body: request.body ? JSON.stringify(request.body) : undefined,
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.error || `Failed to ${action} target`);
        return;
      }
      setSuccessMessage(
        action === "discover"
          ? `Discovered ${data.targets?.length ?? 0} ${PLATFORM_LABELS[platform]} target(s).`
          : `${PLATFORM_LABELS[platform]} target ${action} completed.`,
      );
      await ({ x: refreshX, linkedin: refreshLinkedIn, facebook: refreshFacebook }[platform])();
    } catch {
      setError(`Failed to ${action} ${PLATFORM_LABELS[platform]} target.`);
    } finally {
      setTargetActions((current) => ({ ...current, [platform]: undefined }));
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-heading-1">Settings</h1>
        <p className="text-muted-foreground mt-1">
          Connect platforms via RealTimeX Browser. OAuth API sync is optional.
        </p>
      </div>

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

      <Tabs value={activeTab} onValueChange={handleTabChange}>
        <TabsList variant="line" className="grid w-full grid-cols-2 sm:w-full">
          <TabsTrigger value="platforms">Platform connections</TabsTrigger>
          <TabsTrigger value="agents">AI &amp; agents</TabsTrigger>
        </TabsList>

        <TabsContent value="platforms" className="mt-6">
          <PlatformsTab
            rtxEmbedded={rtxEmbedded}
            xState={xState}
            liState={liState}
            fbState={fbState}
            xOpening={xOpening}
            xValidating={xValidating}
            xDisconnecting={xDisconnecting}
            xOAuthConnecting={xOAuthConnecting}
            xOAuthDisconnecting={xOAuthDisconnecting}
            liOpening={liOpening}
            liValidating={liValidating}
            liDisconnecting={liDisconnecting}
            liOAuthConnecting={liOAuthConnecting}
            liOAuthDisconnecting={liOAuthDisconnecting}
            fbOpening={fbOpening}
            fbValidating={fbValidating}
            fbDisconnecting={fbDisconnecting}
            targetActions={targetActions}
            oauthStatus={oauthStatus}
            oauthConnected={oauthConnected}
            onSessionAction={runSessionAction}
            onOAuthConnect={handleOAuthConnect}
            onOAuthDisconnect={handleOAuthDisconnect}
            onTargetAction={runTargetAction}
          />
        </TabsContent>

        <TabsContent value="agents" className="mt-6">
          <AiAgentsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
