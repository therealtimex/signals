"use client";

import { useState, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Key, CheckCircle, XCircle, Loader2, Monitor, Globe, Trash2, Search } from "lucide-react";
import { PlatformConnectionCard } from "@/components/platform-connection-card";
import { ComingSoonPlatformCards } from "@/components/coming-soon-platform-cards";

type AuthSource = "env_var" | "config" | "none";

interface AuthState {
  status: "loading" | "ready";
  source: AuthSource;
  keyPrefix: string | null;
}

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

interface GmailConnectionState {
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
  const [apiKey, setApiKey] = useState("");
  const [auth, setAuth] = useState<AuthState>({ status: "loading", source: "none", keyPrefix: null });
  const [saving, setSaving] = useState(false);
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

  // Gmail connection state
  const [gmState, setGmState] = useState<GmailConnectionState>({
    loading: true,
    connected: false,
    displayName: null,
    status: null,
    lastSyncedAt: null,
    grantedScopes: "",
  });
  const [gmConnecting, setGmConnecting] = useState(false);
  const [gmDisconnecting, setGmDisconnecting] = useState(false);

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

  // Search API state — Serper
  const [searchApiKey, setSearchApiKey] = useState("");
  const [searchApi, setSearchApi] = useState<{
    loading: boolean;
    configured: boolean;
    source: string;
    keyPrefix: string | null;
  }>({ loading: true, configured: false, source: "none", keyPrefix: null });
  const [searchApiSaving, setSearchApiSaving] = useState(false);

  // Search API state — Tavily
  const [tavilyApiKey, setTavilyApiKey] = useState("");
  const [tavilyApi, setTavilyApi] = useState<{
    loading: boolean;
    configured: boolean;
    source: string;
    keyPrefix: string | null;
  }>({ loading: true, configured: false, source: "none", keyPrefix: null });
  const [tavilyApiSaving, setTavilyApiSaving] = useState(false);

  function fetchSearchApiStatus() {
    fetch("/api/settings/search-api")
      .then((r) => r.json())
      .then((data) => {
        if (data.serper) {
          setSearchApi({
            loading: false,
            configured: data.serper.configured,
            source: data.serper.source ?? "none",
            keyPrefix: data.serper.keyPrefix ?? null,
          });
          setTavilyApi({
            loading: false,
            configured: data.tavily?.configured ?? false,
            source: data.tavily?.source ?? "none",
            keyPrefix: data.tavily?.keyPrefix ?? null,
          });
        } else {
          setSearchApi((prev) => ({ ...prev, loading: false }));
          setTavilyApi((prev) => ({ ...prev, loading: false }));
        }
      })
      .catch(() => {
        setSearchApi((prev) => ({ ...prev, loading: false }));
        setTavilyApi((prev) => ({ ...prev, loading: false }));
      });
  }

  async function handleSearchApiSave() {
    if (!searchApiKey.trim()) return;
    setSearchApiSaving(true);
    setError(null);

    try {
      const res = await fetch("/api/settings/search-api", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "save_key", apiKey: searchApiKey.trim(), provider: "serper" }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error);
      } else {
        setSearchApiKey("");
        fetchSearchApiStatus();
      }
    } catch {
      setError("Failed to save Serper API key");
    } finally {
      setSearchApiSaving(false);
    }
  }

  async function handleSearchApiClear() {
    await fetch("/api/settings/search-api", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "clear_key", provider: "serper" }),
    });
    fetchSearchApiStatus();
  }

  async function handleTavilyApiSave() {
    if (!tavilyApiKey.trim()) return;
    setTavilyApiSaving(true);
    setError(null);

    try {
      const res = await fetch("/api/settings/search-api", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "save_key", apiKey: tavilyApiKey.trim(), provider: "tavily" }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error);
      } else {
        setTavilyApiKey("");
        fetchSearchApiStatus();
      }
    } catch {
      setError("Failed to save Tavily API key");
    } finally {
      setTavilyApiSaving(false);
    }
  }

  async function handleTavilyApiClear() {
    await fetch("/api/settings/search-api", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "clear_key", provider: "tavily" }),
    });
    fetchSearchApiStatus();
  }

  function fetchAuth() {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((data) => {
        setAuth({ status: "ready", source: data.source ?? "none", keyPrefix: data.keyPrefix ?? null });
      })
      .catch(() => setAuth({ status: "ready", source: "none", keyPrefix: null }));
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

  function fetchGmailStatus() {
    fetch("/api/platforms/gmail")
      .then((r) => r.json())
      .then((data) => {
        setGmState({
          loading: false,
          connected: data.connected,
          displayName: data.account?.displayName ?? null,
          status: data.account?.status ?? null,
          lastSyncedAt: data.account?.lastSyncedAt ?? null,
          grantedScopes: data.account?.grantedScopes ?? "",
        });
      })
      .catch(() => {
        setGmState((prev) => ({ ...prev, loading: false }));
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
    fetchAuth();
    fetchXStatus();
    fetchLinkedInStatus();
    fetchGmailStatus();
    fetchBrowserSession();
    fetchLiBrowserSession();
    fetchSearchApiStatus();
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
    } else if (connected === "gmail") {
      setSuccessMessage("Gmail account connected successfully!");
      fetchGmailStatus();
      window.history.replaceState({}, "", "/dashboard/settings");
    } else if (oauthError) {
      setError(`OAuth error: ${oauthError}`);
      window.history.replaceState({}, "", "/dashboard/settings");
    }
  }, [searchParams]);

  async function handleSave() {
    if (!apiKey.trim()) return;
    setSaving(true);
    setError(null);

    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "save_key", apiKey: apiKey.trim() }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error);
      } else {
        setApiKey("");
        fetchAuth();
      }
    } catch {
      setError("Failed to save API key");
    } finally {
      setSaving(false);
    }
  }

  async function handleClear() {
    await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "clear_key" }),
    });
    fetchAuth();
  }

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


  async function handleGmailConnect() {
    setGmConnecting(true);
    setError(null);

    try {
      const res = await fetch("/api/platforms/gmail/auth");
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Failed to start Google OAuth flow");
        return;
      }

      window.location.href = data.authUrl;
    } catch {
      setError("Failed to connect to Gmail");
    } finally {
      setGmConnecting(false);
    }
  }

  async function handleGmailDisconnect() {
    setGmDisconnecting(true);
    setError(null);

    try {
      const res = await fetch("/api/platforms/gmail", { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Failed to disconnect");
        return;
      }
      setGmState({
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
      setGmDisconnecting(false);
    }
  }


  function getGmailConnectionStatus(): "disconnected" | "connected" | "needs_reauth" {
    if (!gmState.connected) return "disconnected";
    if (gmState.status === "needs_reauth") return "needs_reauth";
    return "connected";
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
          Configure API keys and platform connections.
        </p>
      </div>

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

      {/* Claude / Anthropic API Key */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <CardTitle className="flex items-center gap-2">
                <Key className="h-5 w-5" />
                Anthropic API Key
              </CardTitle>
              <CardDescription>
                Required for Claude-powered agents and AI chat. Get a key at{" "}
                <a
                  href="https://console.anthropic.com/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline"
                >
                  console.anthropic.com
                </a>
              </CardDescription>
            </div>
            {auth.status === "loading" ? (
              <Badge variant="outline">
                <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                Checking
              </Badge>
            ) : auth.source === "env_var" ? (
              <Badge variant="default" className="bg-green-600">
                <Monitor className="mr-1 h-3 w-3" />
                Environment Variable
              </Badge>
            ) : auth.source === "config" ? (
              <Badge variant="default" className="bg-green-600">
                <CheckCircle className="mr-1 h-3 w-3" />
                Connected
              </Badge>
            ) : (
              <Badge variant="secondary">
                <XCircle className="mr-1 h-3 w-3" />
                Not configured
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {auth.status === "loading" ? null : auth.source === "env_var" ? (
            /* State A: Env var detected */
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                API key detected from environment variable <code className="rounded bg-muted px-1 py-0.5 text-xs">ANTHROPIC_API_KEY</code>
              </p>
              {auth.keyPrefix && (
                <p className="font-mono text-sm text-muted-foreground">
                  {auth.keyPrefix}
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                To change this key, update your <code className="rounded bg-muted px-1 py-0.5 text-xs">.env.local</code> file and restart the server.
              </p>
            </div>
          ) : auth.source === "config" ? (
            /* State B: Saved key in config */
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <p className="text-sm text-muted-foreground">
                    API key saved and encrypted on this machine.
                  </p>
                  {auth.keyPrefix && (
                    <p className="font-mono text-sm text-muted-foreground">
                      {auth.keyPrefix}
                    </p>
                  )}
                </div>
                <Button variant="destructive" size="sm" onClick={handleClear}>
                  Remove Key
                </Button>
              </div>
            </div>
          ) : (
            /* State C: No key configured */
            <>
              <div className="space-y-2">
                <Label htmlFor="api-key">API Key</Label>
                <Input
                  id="api-key"
                  type="password"
                  placeholder="sk-ant-..."
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSave()}
                />
              </div>
              <Button onClick={handleSave} disabled={saving || !apiKey.trim()}>
                {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Save & Validate
              </Button>
              <p className="text-xs text-muted-foreground">
                Or set <code className="rounded bg-muted px-1 py-0.5 text-xs">ANTHROPIC_API_KEY</code> in <code className="rounded bg-muted px-1 py-0.5 text-xs">.env.local</code> and restart the server.
              </p>
            </>
          )}
        </CardContent>
      </Card>

      {/* Serper API Key */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <CardTitle className="flex items-center gap-2">
                <Search className="h-5 w-5" />
                Serper API Key
              </CardTitle>
              <CardDescription>
                Used for broad discovery queries (prospecting, trending topics). Get a free key at{" "}
                <a
                  href="https://serper.dev"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline"
                >
                  serper.dev
                </a>
                {" "}(2,500 free queries, one-time).
              </CardDescription>
            </div>
            {searchApi.loading ? (
              <Badge variant="outline">
                <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                Checking
              </Badge>
            ) : searchApi.configured ? (
              <Badge variant="default" className="bg-green-600">
                <CheckCircle className="mr-1 h-3 w-3" />
                {searchApi.source === "env_var" ? "Environment Variable" : "Connected"}
              </Badge>
            ) : (
              <Badge variant="secondary">
                <XCircle className="mr-1 h-3 w-3" />
                Not configured
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {searchApi.loading ? null : searchApi.configured ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <p className="text-sm text-muted-foreground">
                    {searchApi.source === "env_var"
                      ? "Key detected from environment variable."
                      : "API key saved and encrypted."}
                  </p>
                  {searchApi.keyPrefix && (
                    <p className="font-mono text-sm text-muted-foreground">
                      {searchApi.keyPrefix}
                    </p>
                  )}
                </div>
                {searchApi.source !== "env_var" && (
                  <Button variant="destructive" size="sm" onClick={handleSearchApiClear}>
                    Remove Key
                  </Button>
                )}
              </div>
            </div>
          ) : (
            <>
              <div className="space-y-2">
                <Label htmlFor="search-api-key">Serper API Key</Label>
                <Input
                  id="search-api-key"
                  type="password"
                  placeholder="Enter your Serper API key"
                  value={searchApiKey}
                  onChange={(e) => setSearchApiKey(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSearchApiSave()}
                />
              </div>
              <Button
                onClick={handleSearchApiSave}
                disabled={searchApiSaving || !searchApiKey.trim()}
              >
                {searchApiSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Save & Validate
              </Button>
              <p className="text-xs text-muted-foreground">
                Or set <code className="rounded bg-muted px-1 py-0.5 text-xs">SERPER_API_KEY</code> in <code className="rounded bg-muted px-1 py-0.5 text-xs">.env.local</code> and restart.
              </p>
            </>
          )}
        </CardContent>
      </Card>

      {/* Tavily Search API Key */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <CardTitle className="flex items-center gap-2">
                <Search className="h-5 w-5" />
                Tavily Search API Key
              </CardTitle>
              <CardDescription>
                Used for deep research queries (enrichment, person lookup). Get a free key at{" "}
                <a
                  href="https://tavily.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline"
                >
                  tavily.com
                </a>
                {" "}(1,000 free searches/month).
              </CardDescription>
            </div>
            {tavilyApi.loading ? (
              <Badge variant="outline">
                <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                Checking
              </Badge>
            ) : tavilyApi.configured ? (
              <Badge variant="default" className="bg-green-600">
                <CheckCircle className="mr-1 h-3 w-3" />
                {tavilyApi.source === "env_var" ? "Environment Variable" : "Connected"}
              </Badge>
            ) : (
              <Badge variant="secondary">
                <XCircle className="mr-1 h-3 w-3" />
                Not configured
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {tavilyApi.loading ? null : tavilyApi.configured ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <p className="text-sm text-muted-foreground">
                    {tavilyApi.source === "env_var"
                      ? "Key detected from environment variable."
                      : "API key saved and encrypted."}
                  </p>
                  {tavilyApi.keyPrefix && (
                    <p className="font-mono text-sm text-muted-foreground">
                      {tavilyApi.keyPrefix}
                    </p>
                  )}
                </div>
                {tavilyApi.source !== "env_var" && (
                  <Button variant="destructive" size="sm" onClick={handleTavilyApiClear}>
                    Remove Key
                  </Button>
                )}
              </div>
            </div>
          ) : (
            <>
              <div className="space-y-2">
                <Label htmlFor="tavily-api-key">Tavily API Key</Label>
                <Input
                  id="tavily-api-key"
                  type="password"
                  placeholder="tvly-..."
                  value={tavilyApiKey}
                  onChange={(e) => setTavilyApiKey(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleTavilyApiSave()}
                />
              </div>
              <Button
                onClick={handleTavilyApiSave}
                disabled={tavilyApiSaving || !tavilyApiKey.trim()}
              >
                {tavilyApiSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Save & Validate
              </Button>
              <p className="text-xs text-muted-foreground">
                Or set <code className="rounded bg-muted px-1 py-0.5 text-xs">TAVILY_API_KEY</code> in <code className="rounded bg-muted px-1 py-0.5 text-xs">.env.local</code> and restart.
              </p>
            </>
          )}
        </CardContent>
      </Card>

      <Separator />

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

          {/* Gmail Connection */}
          {gmState.loading ? (
            <div className="flex items-center justify-center rounded-lg border p-4">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              <span className="text-sm text-muted-foreground">Loading Gmail status...</span>
            </div>
          ) : (
            <PlatformConnectionCard
              platform="gmail"
              displayName="Gmail / Google"
              accountHandle={gmState.displayName ?? undefined}
              lastSyncedAt={gmState.lastSyncedAt}
              status={getGmailConnectionStatus()}
              syncCapable={true}
              grantedScopes={gmState.grantedScopes || undefined}
              showSync={false}
              onConnect={handleGmailConnect}
              onDisconnect={handleGmailDisconnect}
              onSync={() => {}}
              connecting={gmConnecting}
              disconnecting={gmDisconnecting}
            />
          )}

          <ComingSoonPlatformCards />

          <Separator />

          {/* Browser Sessions */}
          <div className="space-y-3">
            <h3 className="text-sm font-medium flex items-center gap-2">
              <Globe className="h-4 w-4" />
              Browser Sessions
            </h3>
            <p className="text-xs text-muted-foreground">
              Browser sessions enable enrichment (scraping profiles) and publishing (posting content).
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
