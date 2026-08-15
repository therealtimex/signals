"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  CheckCircle,
  XCircle,
  AlertTriangle,
  Loader2,
  RefreshCw,
  Unplug,
  ArrowUpCircle,
  ChevronDown,
  ChevronRight,
  Shield,
} from "lucide-react";

export type ConnectionStatus = "disconnected" | "connected" | "needs_reauth" | "coming_soon";

/** Statuses that render a Connect or Reconnect button. */
export const CONNECTION_STATUSES_WITH_CONNECT_ACTION: ConnectionStatus[] = [
  "disconnected",
  "needs_reauth",
];

interface PlatformConnectionCardProps {
  platform: string;
  displayName: string;
  accountHandle?: string;
  lastSyncedAt?: number | null;
  status: ConnectionStatus;
  syncCapable?: boolean;
  grantedScopes?: string;
  showSync?: boolean;
  onConnect?: () => void;
  onDisconnect?: () => void;
  onSync?: () => void;
  onEnableSync?: () => void;
  connecting?: boolean;
  syncing?: boolean;
  disconnecting?: boolean;
}

/** Scope metadata: friendly label and capability group. */
const SCOPE_META: Record<string, { label: string; group: string }> = {
  // LinkedIn scopes
  "openid": { label: "OpenID Connect", group: "Auth" },
  "profile": { label: "Read Profile", group: "Profile" },
  "email": { label: "Read Email", group: "Profile" },
  "r_connections": { label: "Read Connections", group: "Contacts" },
  "w_member_social": { label: "Create Posts", group: "Content" },
  // Google scopes (full URLs — displayed as friendly labels)
  "https://www.googleapis.com/auth/contacts.readonly": { label: "Read Contacts", group: "Contacts" },
  "https://www.googleapis.com/auth/gmail.readonly": { label: "Read Email", group: "Email" },
  // X scopes
  "tweet.read": { label: "Read Tweets", group: "Tweets" },
  "tweet.write": { label: "Write Tweets", group: "Tweets" },
  "tweet.moderate.write": { label: "Moderate Replies", group: "Tweets" },
  "users.read": { label: "Read Profiles", group: "Users" },
  "like.read": { label: "Read Likes", group: "Engagement" },
  "like.write": { label: "Like Tweets", group: "Engagement" },
  "bookmark.read": { label: "Read Bookmarks", group: "Engagement" },
  "bookmark.write": { label: "Save Bookmarks", group: "Engagement" },
  "dm.read": { label: "Read DMs", group: "DMs" },
  "dm.write": { label: "Send DMs", group: "DMs" },
  "follows.read": { label: "Read Follows", group: "Contacts" },
  "follows.write": { label: "Follow/Unfollow", group: "Contacts" },
  "list.read": { label: "Read Lists", group: "Lists" },
  "list.write": { label: "Manage Lists", group: "Lists" },
  "mute.read": { label: "Read Mutes", group: "Moderation" },
  "mute.write": { label: "Mute Accounts", group: "Moderation" },
  "block.read": { label: "Read Blocks", group: "Moderation" },
  "block.write": { label: "Block Accounts", group: "Moderation" },
  "space.read": { label: "Read Spaces", group: "Other" },
  "offline.access": { label: "Offline Access", group: "Other" },
};

/** Group order for display. */
const GROUP_ORDER = ["Auth", "Profile", "Content", "Tweets", "Users", "Engagement", "Email", "DMs", "Contacts", "Lists", "Moderation", "Other"];

/** Scopes that require Basic+ tier. */
const BASIC_PLUS_SCOPES = new Set([
  "follows.read", "follows.write",
  "list.read", "list.write",
  "mute.read", "mute.write",
  "block.read", "block.write",
  "space.read",
]);

function groupScopes(scopeString: string): { group: string; scopes: { scope: string; label: string; basicPlus: boolean }[] }[] {
  const scopes = scopeString.split(" ").filter(Boolean);
  const grouped = new Map<string, { scope: string; label: string; basicPlus: boolean }[]>();

  for (const scope of scopes) {
    const meta = SCOPE_META[scope];
    const group = meta?.group ?? "Other";
    const label = meta?.label ?? scope;

    if (!grouped.has(group)) grouped.set(group, []);
    grouped.get(group)!.push({ scope, label, basicPlus: BASIC_PLUS_SCOPES.has(scope) });
  }

  return GROUP_ORDER
    .filter((g) => grouped.has(g))
    .map((group) => ({ group, scopes: grouped.get(group)! }));
}

function formatRelativeTime(unixSeconds: number): string {
  const now = Math.floor(Date.now() / 1000);
  const diff = now - unixSeconds;

  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export function PlatformConnectionCard({
  displayName,
  accountHandle,
  lastSyncedAt,
  status,
  syncCapable,
  grantedScopes,
  showSync = true,
  onConnect,
  onDisconnect,
  onSync,
  onEnableSync,
  connecting,
  syncing,
  disconnecting,
}: PlatformConnectionCardProps) {
  const [scopesOpen, setScopesOpen] = useState(false);
  const showScopes = status === "connected" && grantedScopes;

  return (
    <div className="rounded-lg border">
      <div className="flex items-center justify-between p-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <p className="font-medium">{displayName}</p>
            {status === "connected" && (
              <Badge variant="default" className="bg-green-600">
                <CheckCircle className="mr-1 h-3 w-3" />
                Connected
              </Badge>
            )}
            {status === "needs_reauth" && (
              <Badge variant="destructive">
                <AlertTriangle className="mr-1 h-3 w-3" />
                Needs Re-auth
              </Badge>
            )}
            {status === "disconnected" && (
              <Badge variant="secondary">
                <XCircle className="mr-1 h-3 w-3" />
                Not connected
              </Badge>
            )}
            {status === "coming_soon" && (
              <Badge variant="secondary">
                Coming soon
              </Badge>
            )}
          </div>

          {status === "connected" && accountHandle && (
            <p className="text-sm text-muted-foreground">
              Signed in as <span className="font-mono">{accountHandle}</span>
            </p>
          )}
          {status === "connected" && lastSyncedAt && (
            <p className="text-xs text-muted-foreground">
              Last synced {formatRelativeTime(lastSyncedAt)}
            </p>
          )}
          {status === "connected" && !syncCapable && (
            <p className="text-xs text-muted-foreground">
              Contact sync requires X API Basic tier ($200/mo)
            </p>
          )}
          {status === "disconnected" && (
            <p className="text-sm text-muted-foreground">
              Connect via OAuth 2.0 to post and import contacts
            </p>
          )}
          {status === "needs_reauth" && (
            <p className="text-sm text-muted-foreground">
              Your session expired. Reconnect to continue syncing.
            </p>
          )}
          {status === "coming_soon" && (
            <p className="text-sm text-muted-foreground">
              OAuth connection is not available yet. You can add identities for this platform manually or via agents.
            </p>
          )}
        </div>

        <div className="flex items-center gap-2">
          {status === "disconnected" && onConnect && (
            <Button onClick={onConnect} disabled={connecting}>
              {connecting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Connect
            </Button>
          )}

          {status === "needs_reauth" && onConnect && (
            <Button onClick={onConnect} variant="outline" disabled={connecting}>
              {connecting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Reconnect
            </Button>
          )}

          {status === "connected" && onDisconnect && (
            <>
              {showSync && syncCapable && onSync ? (
                <Button
                  onClick={onSync}
                  variant="outline"
                  size="sm"
                  disabled={syncing}
                >
                  {syncing ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCw className="mr-2 h-4 w-4" />
                  )}
                  {syncing ? "Syncing..." : "Sync Now"}
                </Button>
              ) : showSync && onEnableSync ? (
                <Button
                  onClick={onEnableSync}
                  variant="outline"
                  size="sm"
                  disabled={connecting}
                >
                  {connecting ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <ArrowUpCircle className="mr-2 h-4 w-4" />
                  )}
                  Enable Contact Sync
                </Button>
              ) : null}
              <Button
                onClick={onDisconnect}
                variant="ghost"
                size="sm"
                disabled={disconnecting}
                className="text-destructive hover:text-destructive"
              >
                {disconnecting ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Unplug className="mr-2 h-4 w-4" />
                )}
                Disconnect
              </Button>
            </>
          )}
        </div>
      </div>

      {showScopes && (
        <div className="border-t">
          <button
            type="button"
            onClick={() => setScopesOpen(!scopesOpen)}
            className="flex w-full items-center gap-2 px-4 py-2 text-xs text-muted-foreground hover:bg-muted/50 transition-colors"
          >
            {scopesOpen ? (
              <ChevronDown className="h-3 w-3" />
            ) : (
              <ChevronRight className="h-3 w-3" />
            )}
            <Shield className="h-3 w-3" />
            <span>Granted Permissions ({grantedScopes.split(" ").filter(Boolean).length})</span>
          </button>

          {scopesOpen && (
            <div className="px-4 pb-3 space-y-2">
              {groupScopes(grantedScopes).map(({ group, scopes }) => (
                <div key={group} className="flex items-start gap-2">
                  <span className="text-xs font-medium text-muted-foreground w-24 shrink-0 pt-0.5">
                    {group}
                  </span>
                  <div className="flex flex-wrap gap-1">
                    {scopes.map(({ scope, label, basicPlus }) => (
                      <Badge
                        key={scope}
                        variant="outline"
                        className="text-[10px] px-1.5 py-0 font-normal"
                      >
                        {label}
                        {basicPlus && (
                          <span className="ml-1 text-[9px] text-muted-foreground/60">Basic+</span>
                        )}
                      </Badge>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
