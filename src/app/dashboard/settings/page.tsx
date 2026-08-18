"use client";

import { useState, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { CheckCircle, XCircle, Loader2, Globe, Trash2 } from "lucide-react";
import { PlatformConnectionCard } from "@/components/platform-connection-card";
import { ComingSoonPlatformCards } from "@/components/coming-soon-platform-cards";
import { HimalayaMailAccountsSection } from "@/components/himalaya-mail-accounts-section";

interface XConnectionState {
  loading: boolean;
  connected: boolean;
  displayName: string | null;
  status: "active" | "paused" | "needs_reauth" | null;
  lastSyncedAt: number | null;
  syncCapable: boolean;
  grantedScopes: string;
}

interface LinkedInConnectionState {
  loading: boolean;
  connected: boolean;
  displayName: string | null;
  status: "active" | "paused" | "needs_reauth" | null;
  lastSyncedAt: number | null;
  grantedScopes: string;
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

  // X connection state
  const [xState, setXState] = useState<XConnectionState>({
    loading: true,
    connected: false,
    displayName: null,
    status: null,
    lastSyncedAt: null,
    syncCapable: false,
    grantedScopes: "",
  });
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // LinkedIn connection state
  const [liState, setLiState] = useState<LinkedInConnectionState>({
    loading: true,
    connected: false,
    displayName: null,
    status: null,
    lastSyncedAt: null,
    grantedScopes: "",
  });
  const [liConnecting, setLiConnecting] = useState(false);
  const [liDisconnecting, setLiDisconnecting] = useState(false);

  // Browser session state
  const [browserSession, setBrowserSession] = useState<{
    loading: boolean;
    hasSession: boolean;
    lastValidatedAt: number | null;
    createdAt: number | null;
  }>({ loading: true, hasSession: false, lastValidatedAt: null, createdAt: null });
  const [browserSettingUp, setBrowserSettingUp] = useState(false);
  const [browserValidating, setBrowserValidating] = useState(false);
  const [browserClearing, setBrowserClearing] = useState(false);

  // LinkedIn browser session state
  const [liBrowserSession, setLiBrowserSession] = useState<{
    loading: boolean;
    hasSession: boolean;
    lastValidatedAt: number | null;
    createdAt: number | null;
  }>({ loading: true, hasSession: false, lastValidatedAt: null, createdAt: null });
  const [liBrowserSettingUp, setLiBrowserSettingUp] = useState(false);
  const [liBrowserValidating, setLiBrowserValidating] = useState(false);
  const [liBrowserClearing, setLiBrowserClearing] = useState(false);

  function fetchRtxMode() {
    fetch("/api/health")
      .then((r) => r.json())
      .then((data) => {
        setRtxEmbedded(data?.rtx?.mode === "embedded");
      })
      .catch(() => setRtxEmbedded(false));
  }

  function fetchXStatus() {
    fetch("/api/platforms/x")
      .then((r) => r.json())
      .then((data) => {
        setXState({
          loading: false,
          connected: data.connected,
          displayName: data.account?.displayName ?? null,
          status: data.account?.status ?? null,
          lastSyncedAt: data.account?.lastSyncedAt ?? null,
          syncCapable: data.account?.syncCapable ?? false,
          grantedScopes: data.account?.grantedScopes ?? "",
        });
      })
      .catch(() => {
        setXState((prev) => ({ ...prev, loading: false }));
      });
  }


  function fetchLinkedInStatus() {
    fetch("/api/platforms/linkedin")
      .then((r) => r.json())
      .then((data) => {
        setLiState({
          loading: false,
          connected: data.connected,
          displayName: data.account?.displayName ?? null,
          status: data.account?.status ?? null,
          lastSyncedAt: data.account?.lastSyncedAt ?? null,
          grantedScopes: data.account?.grantedScopes ?? "",
        });
      })
      .catch(() => {
        setLiState((prev) => ({ ...prev, loading: false }));
      });
  }

  function fetchBrowserSession() {
    fetch("/api/platforms/x/browser-session")
      .then((r) => r.json())
      .then((data) => {
        setBrowserSession({
          loading: false,
          hasSession: data.hasSession,
          lastValidatedAt: data.lastValidatedAt ?? null,
          createdAt: data.createdAt ?? null,
        });
      })
      .catch(() => {
        setBrowserSession((prev) => ({ ...prev, loading: false }));
      });
  }


  async function handleBrowserSetup() {
    setBrowserSettingUp(true);
    setError(null);
    try {
      const res = await fetch("/api/platforms/x/browser-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "setup" }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Browser session setup failed");
        return;
      }
      setSuccessMessage("Browser session created successfully!");
      fetchBrowserSession();
    } catch {
      setError("Browser session setup failed");
    } finally {
      setBrowserSettingUp(false);
    }
  }

  async function handleBrowserValidate() {
    setBrowserValidating(true);
    setError(null);
    try {
      const res = await fetch("/api/platforms/x/browser-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "validate" }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Validation failed");
        return;
      }
      if (data.isValid) {
        setSuccessMessage("Browser session is valid!");
      } else {
        setError("Browser session is invalid or expired. Please set up a new session.");
      }
      fetchBrowserSession();
    } catch {
      setError("Validation failed");
    } finally {
      setBrowserValidating(false);
    }
  }

  async function handleBrowserClear() {
    setBrowserClearing(true);
    setError(null);
    try {
      await fetch("/api/platforms/x/browser-session", { method: "DELETE" });
      setBrowserSession({ loading: false, hasSession: false, lastValidatedAt: null, createdAt: null });
    } catch {
      setError("Failed to clear session");
    } finally {
      setBrowserClearing(false);
    }
  }

  function fetchLiBrowserSession() {
    fetch("/api/platforms/linkedin/browser-session")
      .then((r) => r.json())
      .then((data) => {
        setLiBrowserSession({
          loading: false,
          hasSession: data.hasSession,
          lastValidatedAt: data.lastValidatedAt ?? null,
          createdAt: data.createdAt ?? null,
        });
      })
      .catch(() => {
        setLiBrowserSession((prev) => ({ ...prev, loading: false }));
      });
  }

  async function handleLiBrowserSetup() {
    setLiBrowserSettingUp(true);
    setError(null);
    try {
      const res = await fetch("/api/platforms/linkedin/browser-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "setup" }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "LinkedIn browser session setup failed");
        return;
      }
      setSuccessMessage("LinkedIn browser session created successfully!");
      fetchLiBrowserSession();
    } catch {
      setError("LinkedIn browser session setup failed");
    } finally {
      setLiBrowserSettingUp(false);
    }
  }

  async function handleLiBrowserValidate() {
    setLiBrowserValidating(true);
    setError(null);
    try {
      const res = await fetch("/api/platforms/linkedin/browser-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "validate" }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Validation failed");
        return;
      }
      if (data.isValid) {
        setSuccessMessage("LinkedIn browser session is valid!");
      } else {
        setError("LinkedIn browser session is invalid or expired. Please set up a new session.");
      }
      fetchLiBrowserSession();
    } catch {
      setError("Validation failed");
    } finally {
      setLiBrowserValidating(false);
    }
  }

  async function handleLiBrowserClear() {
    setLiBrowserClearing(true);
    setError(null);
    try {
      await fetch("/api/platforms/linkedin/browser-session", { method: "DELETE" });
      setLiBrowserSession({ loading: false, hasSession: false, lastValidatedAt: null, createdAt: null });
    } catch {
      setError("Failed to clear LinkedIn session");
    } finally {
      setLiBrowserClearing(false);
    }
  }

  useEffect(() => {
    fetchRtxMode();
    fetchXStatus();
    fetchLinkedInStatus();
    fetchBrowserSession();
    fetchLiBrowserSession();
  }, []);

  // Handle OAuth callback query params
  useEffect(() => {
    const connected = searchParams.get("connected");
    const oauthError = searchParams.get("error");

    if (connected === "x") {
      setSuccessMessage("X account connected successfully!");
      fetchXStatus();
      window.history.replaceState({}, "", "/dashboard/settings");
    } else if (connected === "linkedin") {
      setSuccessMessage("LinkedIn account connected successfully!");
      fetchLinkedInStatus();
      window.history.replaceState({}, "", "/dashboard/settings");
    } else if (oauthError) {
      setError(`OAuth error: ${oauthError}`);
      window.history.replaceState({}, "", "/dashboard/settings");
    }
  }, [searchParams]);

  async function handleXConnect(extended = false) {
    setConnecting(true);
    setError(null);

    try {
      const url = extended ? "/api/platforms/x/auth?extended=true" : "/api/platforms/x/auth";
      const res = await fetch(url);
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Failed to start OAuth flow");
        return;
      }

      // Redirect to X authorization page
      window.location.href = data.authUrl;
    } catch {
      setError("Failed to connect to X");
    } finally {
      setConnecting(false);
    }
  }

  async function handleXDisconnect() {
    setDisconnecting(true);
    setError(null);

    try {
      const res = await fetch("/api/platforms/x", { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Failed to disconnect");
        return;
      }
      setXState({
        loading: false,
        connected: false,
        displayName: null,
        status: null,
        lastSyncedAt: null,
        syncCapable: false,
        grantedScopes: "",
      });
    } catch {
      setError("Failed to disconnect");
    } finally {
      setDisconnecting(false);
    }
  }


  async function handleLinkedInConnect() {
    setLiConnecting(true);
    setError(null);

    try {
      const res = await fetch("/api/platforms/linkedin/auth");
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Failed to start LinkedIn OAuth flow");
        return;
      }

      window.location.href = data.authUrl;
    } catch {
      setError("Failed to connect to LinkedIn");
    } finally {
      setLiConnecting(false);
    }
  }

  async function handleLinkedInDisconnect() {
    setLiDisconnecting(true);
    setError(null);

    try {
      const res = await fetch("/api/platforms/linkedin", { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Failed to disconnect");
        return;
      }
      setLiState({
        loading: false,
        connected: false,
        displayName: null,
        status: null,
        lastSyncedAt: null,
        grantedScopes: "",
      });
    } catch {
      setError("Failed to disconnect");
    } finally {
      setLiDisconnecting(false);
    }
  }


  function getLinkedInConnectionStatus(): "disconnected" | "connected" | "needs_reauth" {
    if (!liState.connected) return "disconnected";
    if (liState.status === "needs_reauth") return "needs_reauth";
    return "connected";
  }

  function formatSyncTime(unix: number | null | undefined): string {
    if (!unix) return "Never";
    return new Date(unix * 1000).toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  }

  function getXConnectionStatus(): "disconnected" | "connected" | "needs_reauth" {
    if (!xState.connected) return "disconnected";
    if (xState.status === "needs_reauth") return "needs_reauth";
    return "connected";
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-heading-1">Settings</h1>
        <p className="text-muted-foreground mt-1">
          Connect your platforms and accounts.
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

      {/* Success message */}
      {successMessage && (
        <div className="rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-800 dark:border-green-800 dark:bg-green-950 dark:text-green-200">
          <div className="flex items-center gap-2">
            <CheckCircle className="h-4 w-4" />
            {successMessage}
          </div>
        </div>
      )}

      {/* Error message */}
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
          {error}
        </div>
      )}

      {/* Platform Connections */}
      <Card>
        <CardHeader>
          <CardTitle>Platform Connections</CardTitle>
          <CardDescription>
            Connect your social media accounts for AI-powered engagement.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {xState.loading ? (
            <div className="flex items-center justify-center rounded-lg border p-4">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              <span className="text-sm text-muted-foreground">Loading connection status...</span>
            </div>
          ) : (
            <PlatformConnectionCard
              platform="x"
              displayName="X / Twitter"
              accountHandle={xState.displayName ?? undefined}
              lastSyncedAt={xState.lastSyncedAt}
              status={getXConnectionStatus()}
              syncCapable={xState.syncCapable}
              grantedScopes={xState.grantedScopes || undefined}
              showSync={false}
              onConnect={() => handleXConnect(false)}
              onDisconnect={handleXDisconnect}
              onSync={() => {}}
              onEnableSync={() => handleXConnect(true)}
              connecting={connecting}
              disconnecting={disconnecting}
            />
          )}

          {/* LinkedIn Connection */}
          {liState.loading ? (
            <div className="flex items-center justify-center rounded-lg border p-4">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              <span className="text-sm text-muted-foreground">Loading LinkedIn status...</span>
            </div>
          ) : (
            <PlatformConnectionCard
              platform="linkedin"
              displayName="LinkedIn"
              accountHandle={liState.displayName ?? undefined}
              lastSyncedAt={liState.lastSyncedAt}
              status={getLinkedInConnectionStatus()}
              syncCapable={true}
              grantedScopes={liState.grantedScopes || undefined}
              showSync={false}
              onConnect={handleLinkedInConnect}
              onDisconnect={handleLinkedInDisconnect}
              onSync={() => {}}
              connecting={liConnecting}
              disconnecting={liDisconnecting}
            />
          )}

          <Separator />

          <HimalayaMailAccountsSection />

          <ComingSoonPlatformCards />

          <Separator />

          {/* Browser Sessions */}
          <div className="space-y-3">
            <h3 className="text-sm font-medium flex items-center gap-2">
              <Globe className="h-4 w-4" />
              Browser Sessions
            </h3>
            <p className="text-xs text-muted-foreground">
              Browser sessions enable publishing and engagement (posting, liking, replying).
              Profile enrichment runs via RealTimeX agent-browser — see docs/rtx-agent-browser-enrichment.md.
              Each platform requires a separate session via manual login.
            </p>

            {browserSession.loading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" />
                Loading session status...
              </div>
            ) : (
              <div className="rounded-lg border p-3 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="space-y-1">
                    <p className="text-sm font-medium">X Browser Session</p>
                    {browserSession.hasSession ? (
                      <p className="text-xs text-muted-foreground">
                        Session active
                        {browserSession.lastValidatedAt && (
                          <> &middot; Last validated {formatSyncTime(browserSession.lastValidatedAt)}</>
                        )}
                      </p>
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        No session configured. Click Setup to log in via browser.
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {browserSession.hasSession ? (
                      <>
                        <Badge variant="default" className="bg-green-600">
                          <CheckCircle className="mr-1 h-3 w-3" />
                          Active
                        </Badge>
                      </>
                    ) : (
                      <Badge variant="secondary">
                        <XCircle className="mr-1 h-3 w-3" />
                        Not configured
                      </Badge>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {!browserSession.hasSession ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleBrowserSetup}
                      disabled={browserSettingUp}
                    >
                      {browserSettingUp ? (
                        <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                      ) : (
                        <Globe className="mr-1 h-3 w-3" />
                      )}
                      {browserSettingUp ? "Opening browser..." : "Setup Session"}
                    </Button>
                  ) : (
                    <>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleBrowserValidate}
                        disabled={browserValidating}
                      >
                        {browserValidating ? (
                          <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                        ) : (
                          <CheckCircle className="mr-1 h-3 w-3" />
                        )}
                        Validate
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={handleBrowserClear}
                        disabled={browserClearing}
                        className="text-destructive hover:text-destructive"
                      >
                        {browserClearing ? (
                          <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                        ) : (
                          <Trash2 className="mr-1 h-3 w-3" />
                        )}
                        Clear
                      </Button>
                    </>
                  )}
                </div>

              </div>
            )}

            {/* LinkedIn Browser Session */}
            {liBrowserSession.loading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" />
                Loading LinkedIn session status...
              </div>
            ) : (
              <div className="rounded-lg border p-3 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="space-y-1">
                    <p className="text-sm font-medium">LinkedIn Browser Session</p>
                    {liBrowserSession.hasSession ? (
                      <p className="text-xs text-muted-foreground">
                        Session active
                        {liBrowserSession.lastValidatedAt && (
                          <> &middot; Last validated {formatSyncTime(liBrowserSession.lastValidatedAt)}</>
                        )}
                      </p>
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        No session configured. Required for LinkedIn browser publishing.
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {liBrowserSession.hasSession ? (
                      <Badge variant="default" className="bg-green-600">
                        <CheckCircle className="mr-1 h-3 w-3" />
                        Active
                      </Badge>
                    ) : (
                      <Badge variant="secondary">
                        <XCircle className="mr-1 h-3 w-3" />
                        Not configured
                      </Badge>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {!liBrowserSession.hasSession ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleLiBrowserSetup}
                      disabled={liBrowserSettingUp}
                    >
                      {liBrowserSettingUp ? (
                        <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                      ) : (
                        <Globe className="mr-1 h-3 w-3" />
                      )}
                      {liBrowserSettingUp ? "Opening browser..." : "Setup Session"}
                    </Button>
                  ) : (
                    <>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleLiBrowserValidate}
                        disabled={liBrowserValidating}
                      >
                        {liBrowserValidating ? (
                          <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                        ) : (
                          <CheckCircle className="mr-1 h-3 w-3" />
                        )}
                        Validate
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={handleLiBrowserClear}
                        disabled={liBrowserClearing}
                        className="text-destructive hover:text-destructive"
                      >
                        {liBrowserClearing ? (
                          <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                        ) : (
                          <Trash2 className="mr-1 h-3 w-3" />
                        )}
                        Clear
                      </Button>
                    </>
                  )}
                </div>
              </div>
            )}

          </div>
        </CardContent>
      </Card>
    </div>
  );
}
