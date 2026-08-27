"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { ConnectionStatus } from "@/components/platform-connection-card";
import { SocialPlatformCard } from "@/components/social-platform-card";
import { ComingSoonPlatformCards } from "@/components/coming-soon-platform-cards";
import { HimalayaMailAccountsSection } from "@/components/himalaya-mail-accounts-section";

export type PlatformPayload = {
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
  targets?: Array<{
    id: string;
    kind: string;
    name: string;
    handle: string | null;
    capabilities: string[];
    isDefault: boolean;
    lastVerifiedAt: number | null;
  }>;
};

export type SessionPayload = {
  hasSession: boolean;
  lastValidatedAt: number | null;
  detectedHandle: string | null;
};

export type PlatformUiState = {
  loading: boolean;
  payload: PlatformPayload | null;
  session: SessionPayload | null;
};

export type PlatformKey = "x" | "linkedin" | "facebook";

export type PlatformsTabProps = {
  rtxEmbedded: boolean;
  xState: PlatformUiState;
  liState: PlatformUiState;
  fbState: PlatformUiState;
  xOpening: boolean;
  xValidating: boolean;
  xDisconnecting: boolean;
  xOAuthConnecting: boolean;
  xOAuthDisconnecting: boolean;
  liOpening: boolean;
  liValidating: boolean;
  liDisconnecting: boolean;
  liOAuthConnecting: boolean;
  liOAuthDisconnecting: boolean;
  fbOpening: boolean;
  fbValidating: boolean;
  fbDisconnecting: boolean;
  targetActions: Partial<Record<PlatformKey, string>>;
  oauthStatus: (payload: PlatformPayload | null) => ConnectionStatus;
  oauthConnected: (payload: PlatformPayload | null) => boolean;
  onSessionAction: (platform: PlatformKey, action: "setup" | "validate" | "disconnect") => void;
  onOAuthConnect: (platform: "x" | "linkedin", extended?: boolean) => void;
  onOAuthDisconnect: (platform: "x" | "linkedin") => void;
  onTargetAction: (
    platform: PlatformKey,
    action: "add" | "discover" | "default" | "verify" | "forget",
    targetId?: string,
  ) => void;
};

export function PlatformsTab({
  rtxEmbedded,
  xState,
  liState,
  fbState,
  xOpening,
  xValidating,
  xDisconnecting,
  xOAuthConnecting,
  xOAuthDisconnecting,
  liOpening,
  liValidating,
  liDisconnecting,
  liOAuthConnecting,
  liOAuthDisconnecting,
  fbOpening,
  fbValidating,
  fbDisconnecting,
  targetActions,
  oauthStatus,
  oauthConnected,
  onSessionAction,
  onOAuthConnect,
  onOAuthDisconnect,
  onTargetAction,
}: PlatformsTabProps) {
  const xPayload = xState.payload;
  const liPayload = liState.payload;
  const fbPayload = fbState.payload;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Platform Connections</CardTitle>
        <CardDescription>
          Browser connections may retain multiple named acting targets. Shared sessions are
          lease-serialized; dedicated sessions can run concurrently. Publish and file-based
          imports work without OAuth.
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
          accountHandle={xState.session?.detectedHandle ?? xPayload?.account?.displayName ?? null}
          lastValidatedAt={xState.session?.lastValidatedAt ?? null}
          hasBrowserSession={!!xState.session?.hasSession || !!xPayload?.hasBrowserSession}
          oauthConnected={oauthConnected(xPayload)}
          oauthStatus={oauthStatus(xPayload)}
          grantedScopes={xPayload?.account?.grantedScopes}
          syncCapable={xPayload?.account?.syncCapable}
          dataHint="Import X archive (Automation)"
          publishHint="agent lane (signals-publish)"
          onOpenSession={() => onSessionAction("x", "setup")}
          onValidate={() => onSessionAction("x", "validate")}
          onDisconnectBrowser={() => onSessionAction("x", "disconnect")}
          onOAuthConnect={() => onOAuthConnect("x", false)}
          onOAuthDisconnect={() => onOAuthDisconnect("x")}
          onEnableOAuthSync={() => onOAuthConnect("x", true)}
          opening={xOpening}
          validating={xValidating}
          disconnectingBrowser={xDisconnecting}
          oauthConnecting={xOAuthConnecting}
          oauthDisconnecting={xOAuthDisconnecting}
          targets={xPayload?.targets}
          targetAction={targetActions.x}
          onAddCurrent={() => onTargetAction("x", "add")}
          onDiscover={() => onTargetAction("x", "discover")}
          onSetDefault={(id) => onTargetAction("x", "default", id)}
          onVerifyTarget={(id) => onTargetAction("x", "verify", id)}
          onForgetTarget={(id) => onTargetAction("x", "forget", id)}
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
          onOpenSession={() => onSessionAction("linkedin", "setup")}
          onValidate={() => onSessionAction("linkedin", "validate")}
          onDisconnectBrowser={() => onSessionAction("linkedin", "disconnect")}
          onOAuthConnect={() => onOAuthConnect("linkedin")}
          onOAuthDisconnect={() => onOAuthDisconnect("linkedin")}
          opening={liOpening}
          validating={liValidating}
          disconnectingBrowser={liDisconnecting}
          oauthConnecting={liOAuthConnecting}
          oauthDisconnecting={liOAuthDisconnecting}
          targets={liPayload?.targets}
          targetAction={targetActions.linkedin}
          onAddCurrent={() => onTargetAction("linkedin", "add")}
          onDiscover={() => onTargetAction("linkedin", "discover")}
          onSetDefault={(id) => onTargetAction("linkedin", "default", id)}
          onVerifyTarget={(id) => onTargetAction("linkedin", "verify", id)}
          onForgetTarget={(id) => onTargetAction("linkedin", "forget", id)}
        />

        <SocialPlatformCard
          platform="facebook"
          displayName="Facebook"
          loading={fbState.loading}
          rtxEmbedded={rtxEmbedded}
          connected={!!fbPayload?.connected}
          connectionVia={fbPayload?.connectionVia ?? null}
          accountHandle={
            fbState.session?.detectedHandle ?? fbPayload?.account?.displayName ?? null
          }
          lastValidatedAt={fbState.session?.lastValidatedAt ?? null}
          hasBrowserSession={!!fbState.session?.hasSession || !!fbPayload?.hasBrowserSession}
          oauthConnected={false}
          oauthStatus="disconnected"
          oauthSupported={false}
          dataHint="agent-browser enrichment (future)"
          publishHint="not yet supported"
          onOpenSession={() => onSessionAction("facebook", "setup")}
          onValidate={() => onSessionAction("facebook", "validate")}
          onDisconnectBrowser={() => onSessionAction("facebook", "disconnect")}
          onOAuthConnect={() => {}}
          onOAuthDisconnect={() => {}}
          opening={fbOpening}
          validating={fbValidating}
          disconnectingBrowser={fbDisconnecting}
          targets={fbPayload?.targets}
          targetAction={targetActions.facebook}
          onAddCurrent={() => onTargetAction("facebook", "add")}
          onDiscover={() => onTargetAction("facebook", "discover")}
          onSetDefault={(id) => onTargetAction("facebook", "default", id)}
          onVerifyTarget={(id) => onTargetAction("facebook", "verify", id)}
          onForgetTarget={(id) => onTargetAction("facebook", "forget", id)}
        />

        <HimalayaMailAccountsSection />
        <ComingSoonPlatformCards />
      </CardContent>
    </Card>
  );
}
