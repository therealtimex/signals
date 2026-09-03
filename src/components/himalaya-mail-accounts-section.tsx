"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertTriangle,
  CheckCircle,
  Loader2,
  Mail,
  Plus,
  RefreshCw,
  Trash2,
  XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";

type MailAccount = {
  id: string;
  alias: string;
  email: string;
  status: "ok" | "error" | "unknown";
  isDefault: boolean;
  lastCheckedAt: number | null;
  checkMessage: string | null;
};

type LegacyOAuth = {
  id: string;
  displayName: string;
  message: string;
};

type SetupInfo = {
  configPath: string;
  steps: string[];
  docs: string;
};

export function HimalayaMailAccountsSection() {
  const [loading, setLoading] = useState(true);
  const [accounts, setAccounts] = useState<MailAccount[]>([]);
  const [configPath, setConfigPath] = useState<string | null>(null);
  const [legacyOAuth, setLegacyOAuth] = useState<LegacyOAuth | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [checkingId, setCheckingId] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [settingDefaultId, setSettingDefaultId] = useState<string | null>(null);
  const [showSetup, setShowSetup] = useState(false);
  const [setupInfo, setSetupInfo] = useState<SetupInfo | null>(null);
  const [disconnectingLegacy, setDisconnectingLegacy] = useState(false);

  const fetchAccounts = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/mail-accounts");
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to load mail accounts");
        return;
      }
      setAccounts(data.accounts ?? []);
      setConfigPath(data.configPath ?? null);
      setLegacyOAuth(data.legacyOAuth ?? null);
    } catch {
      setError("Failed to load mail accounts");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAccounts();
  }, [fetchAccounts]);

  async function handleSync() {
    setSyncing(true);
    setError(null);
    try {
      const res = await fetch("/api/mail-accounts", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to refresh from Himalaya");
        return;
      }
      setAccounts(data.accounts ?? []);
    } catch {
      setError("Failed to refresh from Himalaya");
    } finally {
      setSyncing(false);
    }
  }

  async function handleShowSetup() {
    setShowSetup(true);
    if (setupInfo) return;
    try {
      const res = await fetch("/api/mail-accounts/setup");
      const data = await res.json();
      if (res.ok) setSetupInfo(data);
    } catch {
      // non-fatal
    }
  }

  async function handleSetDefault(id: string) {
    setSettingDefaultId(id);
    setError(null);
    try {
      const res = await fetch(`/api/mail-accounts/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ default: true }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to set default");
        return;
      }
      await fetchAccounts();
    } catch {
      setError("Failed to set default");
    } finally {
      setSettingDefaultId(null);
    }
  }

  async function handleCheck(id: string) {
    setCheckingId(id);
    setError(null);
    try {
      const res = await fetch(`/api/mail-accounts/${id}/check`, { method: "POST" });
      // A failing route may answer with HTML; parsing that threw before the
      // status was read, so the user saw a JSON parse error instead of the
      // check failure.
      const data = (await res.json().catch(() => ({}))) as { error?: string; account?: MailAccount };
      if (!res.ok) {
        setError(data.error || `Check failed (${res.status})`);
        return;
      }
      const checked = data.account;
      if (checked) {
        setAccounts((prev) => prev.map((row) => (row.id === id ? checked : row)));
      }
    } catch {
      setError("Check failed");
    } finally {
      setCheckingId(null);
    }
  }

  async function handleRemove(id: string) {
    setRemovingId(id);
    setError(null);
    try {
      const res = await fetch(`/api/mail-accounts/${id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to remove account");
        return;
      }
      await fetchAccounts();
    } catch {
      setError("Failed to remove account");
    } finally {
      setRemovingId(null);
    }
  }

  async function handleDisconnectLegacy() {
    if (!legacyOAuth) return;
    setDisconnectingLegacy(true);
    setError(null);
    try {
      const res = await fetch("/api/platforms/gmail", { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Failed to disconnect legacy Gmail OAuth");
        return;
      }
      setLegacyOAuth(null);
    } catch {
      setError("Failed to disconnect legacy Gmail OAuth");
    } finally {
      setDisconnectingLegacy(false);
    }
  }

  function statusBadge(status: MailAccount["status"]) {
    if (status === "ok") {
      return (
        <Badge variant="default" className="bg-green-600">
          <CheckCircle className="mr-1 h-3 w-3" />
          OK
        </Badge>
      );
    }
    if (status === "error") {
      return (
        <Badge variant="destructive">
          <XCircle className="mr-1 h-3 w-3" />
          Error
        </Badge>
      );
    }
    return (
      <Badge variant="secondary">
        <AlertTriangle className="mr-1 h-3 w-3" />
        Unknown
      </Badge>
    );
  }

  return (
    <div className="space-y-3 rounded-lg border p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <p className="font-medium flex items-center gap-2">
            <Mail className="h-4 w-4" />
            Google mail (Himalaya)
          </p>
          <p className="text-sm text-muted-foreground">
            Agents read and send mail via Himalaya CLI (<code className="text-xs">-a &lt;alias&gt;</code>,{" "}
            <code className="text-xs">--output json</code>). Configure accounts in terminal; Signals stores
            aliases and the default for agents only — not OAuth tokens.
          </p>
          {configPath && (
            <p className="text-xs text-muted-foreground">
              Config: <code className="rounded bg-muted px-1 py-0.5">{configPath}</code>
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleShowSetup}>
            <Plus className="mr-1 h-3 w-3" />
            Add account
          </Button>
          <Button variant="outline" size="sm" onClick={handleSync} disabled={syncing}>
            {syncing ? (
              <Loader2 className="mr-1 h-3 w-3 animate-spin" />
            ) : (
              <RefreshCw className="mr-1 h-3 w-3" />
            )}
            Refresh
          </Button>
        </div>
      </div>

      {legacyOAuth && (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
          <p className="font-medium">Legacy Gmail OAuth connected ({legacyOAuth.displayName})</p>
          <p className="mt-1 text-xs">{legacyOAuth.message}</p>
          <Button
            variant="outline"
            size="sm"
            className="mt-2"
            onClick={handleDisconnectLegacy}
            disabled={disconnectingLegacy}
          >
            {disconnectingLegacy && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
            Disconnect legacy OAuth
          </Button>
        </div>
      )}

      {error && (
        <p className="text-sm text-destructive">{error}</p>
      )}

      {showSetup && (
        <div className="rounded-md border bg-muted/30 p-3 text-sm space-y-2">
          <p className="font-medium">Configure mail in terminal</p>
          <ol className="list-decimal list-inside space-y-1 text-muted-foreground text-xs">
            {(setupInfo?.steps ?? [
              "Open a RealTimeX terminal agent on this machine.",
              "Run `himalaya account configure` to add a Google mail account.",
              "Return here and click Refresh to import accounts.",
            ]).map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
          <p className="text-xs text-muted-foreground">
            See the RealtimeX BizOps plugin skill for Himalaya setup and credential broker guidance.
          </p>
          <Button variant="ghost" size="sm" onClick={() => setShowSetup(false)}>
            Close
          </Button>
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading mail accounts…
        </div>
      ) : accounts.length === 0 ? (
        <p className="text-sm text-muted-foreground py-2">
          No mail accounts registered. Click <strong>Add account</strong> to configure Himalaya, then{" "}
          <strong>Refresh</strong>.
        </p>
      ) : (
        <div className="space-y-2">
          {accounts.map((account) => (
            <div
              key={account.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-md border px-3 py-2"
            >
              <div className="space-y-0.5 min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-sm truncate">{account.email}</span>
                  <span className="text-xs text-muted-foreground">alias: {account.alias}</span>
                  {statusBadge(account.status)}
                  {account.isDefault && (
                    <Badge variant="outline" className="text-[10px]">
                      Default for agents
                    </Badge>
                  )}
                </div>
                {account.checkMessage && account.status === "error" && (
                  <p className="text-xs text-destructive truncate">{account.checkMessage}</p>
                )}
              </div>
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-1 text-xs cursor-pointer">
                  <input
                    type="radio"
                    name="default-mail-account"
                    checked={account.isDefault}
                    disabled={settingDefaultId === account.id || account.isDefault}
                    onChange={() => handleSetDefault(account.id)}
                    className={cn("h-3.5 w-3.5")}
                  />
                  Default
                </label>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleCheck(account.id)}
                  disabled={checkingId === account.id}
                >
                  {checkingId === account.id ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    "Check"
                  )}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:text-destructive"
                  onClick={() => handleRemove(account.id)}
                  disabled={removingId === account.id}
                  aria-label={`Remove mail account ${account.alias}`}
                  title={`Remove ${account.alias}`}
                >
                  {removingId === account.id ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Trash2 className="h-3 w-3" />
                  )}
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
