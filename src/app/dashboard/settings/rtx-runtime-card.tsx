"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { RtxBootstrapState } from "@/lib/rtx/bootstrap";

type RtxStatusResponse = {
  bootstrap: RtxBootstrapState;
};

type PermissionRow = {
  id: string;
  label: string;
};

const PERMISSION_ROWS: PermissionRow[] = [
  { id: "llm.chat", label: "Persona synthesis (structured workflow)" },
  { id: "llm.embed", label: "Semantic search & persona embeddings" },
  { id: "desktop.runtime-sessions", label: "Terminal agent jobs & publish" },
];

function permissionStatus(
  permissions: RtxBootstrapState["permissions"],
  permissionId: string,
): "granted" | "denied" | "unknown" {
  if (!permissions) return "unknown";
  if (permissions.granted.includes(permissionId)) return "granted";
  if (permissions.denied.includes(permissionId)) return "denied";
  return "unknown";
}

function PermissionBadge({ status }: { status: "granted" | "denied" | "unknown" }) {
  if (status === "granted") {
    return <Badge className="bg-green-600 hover:bg-green-600">Granted</Badge>;
  }
  if (status === "denied") {
    return <Badge variant="destructive">Denied</Badge>;
  }
  return <Badge variant="secondary">Unknown</Badge>;
}

export function RtxRuntimeCard() {
  const [bootstrap, setBootstrap] = useState<RtxBootstrapState | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshMessage, setRefreshMessage] = useState<string | null>(null);

  const loadStatus = useCallback(async (refresh = false) => {
    if (refresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    try {
      const response = await fetch(refresh ? "/api/rtx/status/refresh" : "/api/rtx/status", {
        method: refresh ? "POST" : "GET",
      });
      if (!response.ok) {
        setRefreshMessage("Failed to load RealTimeX runtime status.");
        return;
      }
      const data = (await response.json()) as RtxStatusResponse;
      setBootstrap(data.bootstrap);
      setRefreshMessage(refresh ? "Permission status refreshed." : null);
    } catch {
      setRefreshMessage("Failed to load RealTimeX runtime status.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  const embedded = bootstrap?.mode === "embedded";

  return (
    <Card>
      <CardHeader>
        <CardTitle>RealTimeX runtime</CardTitle>
        <CardDescription>
          Permissions and runtime mode for Signals as a RealTimeX Local App.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">Runtime</span>
          {loading ? (
            <Badge variant="secondary">Loading…</Badge>
          ) : embedded ? (
            <Badge>Embedded in RealTimeX</Badge>
          ) : (
            <Badge variant="secondary">Standalone</Badge>
          )}
        </div>
        {!loading && !embedded && (
          <p className="text-sm text-muted-foreground">
            Persona generation and embeddings need Signals running as a RealTimeX Local App.
          </p>
        )}

        <div className="space-y-3">
          {PERMISSION_ROWS.map((row) => {
            const status = permissionStatus(bootstrap?.permissions ?? null, row.id);
            return (
              <div
                key={row.id}
                className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <p className="text-sm font-medium">{row.label}</p>
                  <p className="text-xs text-muted-foreground">
                    <code className="rounded bg-muted px-1 py-0.5">{row.id}</code>
                  </p>
                </div>
                <PermissionBadge status={status} />
              </div>
            );
          })}
        </div>

        <p className="text-sm text-muted-foreground">
          Approve permissions in RealTimeX → Settings → Local Apps → Signals.
        </p>

        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            variant="outline"
            disabled={loading || refreshing}
            onClick={() => void loadStatus(true)}
          >
            {refreshing ? "Re-checking…" : "Re-check"}
          </Button>
          <p className="text-sm text-muted-foreground" aria-live="polite">
            {refreshMessage}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
