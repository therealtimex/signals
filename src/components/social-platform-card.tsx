"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  CheckCircle,
  XCircle,
  AlertTriangle,
  Loader2,
  Globe,
  Unplug,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Plus,
  Search,
  Star,
  Trash2,
} from "lucide-react";
import {
  PlatformConnectionCard,
  type ConnectionStatus,
} from "@/components/platform-connection-card";

export type SocialPlatformCardProps = {
  platform: "x" | "linkedin" | "facebook";
  displayName: string;
  loading: boolean;
  rtxEmbedded: boolean;
  connected: boolean;
  connectionVia: "browser" | "oauth" | null;
  accountHandle?: string | null;
  lastValidatedAt?: number | null;
  hasBrowserSession: boolean;
  sessionRunning?: boolean;
  oauthConnected: boolean;
  oauthStatus: ConnectionStatus;
  oauthSupported?: boolean;
  grantedScopes?: string;
  syncCapable?: boolean;
  dataHint: string;
  publishHint: string;
  onOpenSession: () => void;
  onValidate: () => void;
  onDisconnectBrowser: () => void;
  onOAuthConnect: () => void;
  onOAuthDisconnect: () => void;
  onEnableOAuthSync?: () => void;
  opening?: boolean;
  validating?: boolean;
  disconnectingBrowser?: boolean;
  oauthConnecting?: boolean;
  oauthDisconnecting?: boolean;
  targets?: Array<{
    id: string;
    kind: string;
    name: string;
    handle: string | null;
    capabilities: string[];
    isDefault: boolean;
    lastVerifiedAt: number | null;
  }>;
  targetAction?: string | null;
  onAddCurrent?: () => void;
  onDiscover?: () => void;
  onSetDefault?: (targetId: string) => void;
  onVerifyTarget?: (targetId: string) => void;
  onForgetTarget?: (targetId: string) => void;
};

function formatSyncTime(unix: number | null | undefined): string {
  if (!unix) return "Never";
  return new Date(unix * 1000).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function SocialPlatformCard(props: SocialPlatformCardProps) {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const {
    displayName,
    loading,
    rtxEmbedded,
    connected,
    connectionVia,
    accountHandle,
    lastValidatedAt,
    hasBrowserSession,
    oauthConnected,
    oauthStatus,
    grantedScopes,
    syncCapable,
    dataHint,
    publishHint,
    onOpenSession,
    onValidate,
    onDisconnectBrowser,
    onOAuthConnect,
    onOAuthDisconnect,
    onEnableOAuthSync,
    opening,
    validating,
    disconnectingBrowser,
    oauthConnecting,
    oauthDisconnecting,
    oauthSupported = true,
    targets = [],
    targetAction,
    onAddCurrent,
    onDiscover,
    onSetDefault,
    onVerifyTarget,
    onForgetTarget,
  } = props;

  if (loading) {
    return (
      <div className="flex items-center justify-center rounded-lg border p-4">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        <span className="text-sm text-muted-foreground">Loading {displayName}...</span>
      </div>
    );
  }

  const browserConnected = connectionVia === "browser" && connected;
  const sessionLabel = rtxEmbedded ? "RealTimeX Browser" : "browser session";

  return (
    <div className="rounded-lg border p-4 space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-medium">{displayName}</p>
            {browserConnected ? (
              <Badge variant="default" className="bg-green-600">
                <CheckCircle className="mr-1 h-3 w-3" />
                Connected
              </Badge>
            ) : (
              <Badge variant="secondary">
                <XCircle className="mr-1 h-3 w-3" />
                Not connected
              </Badge>
            )}
          </div>

          {browserConnected && accountHandle ? (
            <p className="text-sm text-muted-foreground">
              <span className="font-mono">{accountHandle}</span>
              <span> — via {sessionLabel}</span>
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              Sign in with the {sessionLabel} to publish and import data — no OAuth required.
            </p>
          )}

          {browserConnected && lastValidatedAt ? (
            <p className="text-xs text-muted-foreground">
              Last validated {formatSyncTime(lastValidatedAt)}
            </p>
          ) : null}

          <p className="text-xs text-muted-foreground pt-1">
            Data: {dataHint} · Publish: {publishHint}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {!hasBrowserSession ? (
            <Button variant="outline" size="sm" onClick={onOpenSession} disabled={opening}>
              {opening ? (
                <Loader2 className="mr-1 h-3 w-3 animate-spin" />
              ) : (
                <Globe className="mr-1 h-3 w-3" />
              )}
              {opening ? "Opening..." : "Setup session"}
            </Button>
          ) : (
            <>
              <Button variant="outline" size="sm" onClick={onOpenSession} disabled={opening}>
                {opening ? (
                  <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                ) : (
                  <ExternalLink className="mr-1 h-3 w-3" />
                )}
                Open session
              </Button>
              <Button variant="outline" size="sm" onClick={onValidate} disabled={validating}>
                {validating ? (
                  <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                ) : (
                  <CheckCircle className="mr-1 h-3 w-3" />
                )}
                Validate
              </Button>
              {browserConnected ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onDisconnectBrowser}
                  disabled={disconnectingBrowser}
                  className="text-destructive hover:text-destructive"
                >
                  {disconnectingBrowser ? (
                    <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                  ) : (
                    <Unplug className="mr-1 h-3 w-3" />
                  )}
                  Disconnect
                </Button>
              ) : null}
            </>
          )}
        </div>
      </div>

      {rtxEmbedded && (
        <div className="space-y-3 border-t pt-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-sm font-medium">Acting targets</p>
              <p className="text-xs text-muted-foreground">
                Agents select these stable target IDs before browsing or publishing.
              </p>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={onAddCurrent}
                disabled={!onAddCurrent || targetAction === "add"}
              >
                {targetAction === "add" ? (
                  <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                ) : (
                  <Plus className="mr-1 h-3 w-3" />
                )}
                Add current
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={onDiscover}
                disabled={!onDiscover || targetAction === "discover"}
              >
                {targetAction === "discover" ? (
                  <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                ) : (
                  <Search className="mr-1 h-3 w-3" />
                )}
                Discover
              </Button>
            </div>
          </div>

          {targets.length === 0 ? (
            <p className="rounded-md bg-muted/40 p-3 text-xs text-muted-foreground">
              No targets registered. Sign in in the browser session, then add the current target.
            </p>
          ) : (
            <div className="space-y-2">
              {targets.map((target) => (
                <div
                  key={target.id}
                  className="flex flex-col gap-2 rounded-md border bg-muted/20 p-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-sm font-medium">{target.name}</span>
                      <Badge variant="outline">{target.kind}</Badge>
                      {target.isDefault && (
                        <Badge variant="secondary">
                          <Star className="mr-1 h-3 w-3 fill-current" /> Default
                        </Badge>
                      )}
                      {target.capabilities.map((capability) => (
                        <Badge key={capability} variant="outline">{capability}</Badge>
                      ))}
                    </div>
                    <p className="mt-1 truncate font-mono text-xs text-muted-foreground">
                      {target.handle ?? target.id} · {target.id}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Verified {formatSyncTime(target.lastVerifiedAt)}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {!target.isDefault && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => onSetDefault?.(target.id)}
                        disabled={targetAction === target.id}
                      >
                        <Star className="mr-1 h-3 w-3" /> Set default
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onVerifyTarget?.(target.id)}
                      disabled={targetAction === target.id}
                    >
                      {targetAction === target.id ? (
                        <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                      ) : (
                        <CheckCircle className="mr-1 h-3 w-3" />
                      )}
                      Switch & verify
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:text-destructive"
                      onClick={() => onForgetTarget?.(target.id)}
                      disabled={targetAction === target.id}
                    >
                      <Trash2 className="mr-1 h-3 w-3" /> Forget
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {oauthSupported && (rtxEmbedded || oauthConnected) && (
        <div className="border-t pt-3">
          <button
            type="button"
            onClick={() => setAdvancedOpen(!advancedOpen)}
            className="flex w-full items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            {advancedOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            <AlertTriangle className="h-3 w-3" />
            Advanced: OAuth API sync (optional)
          </button>

          {advancedOpen && (
            <div className="mt-3 space-y-2">
              <p className="text-xs text-muted-foreground">
                OAuth enables paid API contact sync (X Basic tier, LinkedIn API). Not required for
                archive import, publish via agent, or Explore graph edges.
              </p>
              <PlatformConnectionCard
                platform={props.platform}
                displayName={`${displayName} OAuth`}
                accountHandle={oauthConnected ? accountHandle ?? undefined : undefined}
                status={oauthStatus}
                syncCapable={syncCapable}
                grantedScopes={grantedScopes || undefined}
                showSync={false}
                onConnect={onOAuthConnect}
                onDisconnect={onOAuthDisconnect}
                onSync={() => {}}
                onEnableSync={onEnableOAuthSync}
                connecting={oauthConnecting}
                disconnecting={oauthDisconnecting}
              />
            </div>
          )}
        </div>
      )}

      {oauthSupported && !rtxEmbedded && !oauthConnected && (
        <div className="border-t pt-3">
          <p className="text-xs text-muted-foreground mb-2">
            Standalone mode also supports optional OAuth API sync:
          </p>
          <PlatformConnectionCard
            platform={props.platform}
            displayName={`${displayName} OAuth`}
            status={oauthStatus}
            syncCapable={syncCapable}
            grantedScopes={grantedScopes || undefined}
            showSync={false}
            onConnect={onOAuthConnect}
            onDisconnect={onOAuthDisconnect}
            onSync={() => {}}
            onEnableSync={onEnableOAuthSync}
            connecting={oauthConnecting}
            disconnecting={oauthDisconnecting}
          />
        </div>
      )}
    </div>
  );
}
