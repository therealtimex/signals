"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { CheckCircle2, Loader2, TriangleAlert } from "lucide-react";
import { AllowWebsiteDialog } from "@/components/allow-website-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { allowedWebsitesApi } from "@/lib/browser/allowed-websites-client";
import type { AllowedOriginsChange, AllowedOriginsView } from "@/lib/browser/allowed-websites-types";
import {
  calloutOriginState,
  groupRecoverableDenials,
  manageAllowedWebsitesHref,
  viewFromChange,
  type BlockedConnectionGroup,
  type BlockedOrigin,
  type CalloutOriginState,
} from "@/lib/browser/allowed-websites-ui";
import type { RunNavigationDenial } from "@/lib/browser/navigation-blocked";

function Mono({ children }: { children: React.ReactNode }) {
  return <code className="font-mono text-foreground break-words [overflow-wrap:anywhere]">{children}</code>;
}

function BlockedLink({ url }: { url: string | null }) {
  if (!url) return null;
  return <p className="text-xs break-words [overflow-wrap:anywhere]">Blocked link: {url}</p>;
}

/** One callout per resolved connection, at the top of the run page (contract §2). */
export function BlockedWebsiteCallouts({ denials }: { denials: readonly RunNavigationDenial[] }) {
  const groups = groupRecoverableDenials(denials);
  if (groups.length === 0) return null;
  return (
    <>
      {groups.map((group) => (
        <BlockedWebsiteCallout key={group.connectionId} group={group} />
      ))}
    </>
  );
}

function BlockedWebsiteCallout({ group }: { group: BlockedConnectionGroup }) {
  const { connectionId, sessionName, origins } = group;
  const [view, setView] = useState<AllowedOriginsView | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const [dialog, setDialog] = useState<{ key: number; target: BlockedOrigin } | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const calloutRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLButtonElement | null>(null);
  const focusCalloutOnClose = useRef(false);

  const load = useCallback(async () => {
    const outcome = await allowedWebsitesApi.get(connectionId);
    if (outcome.status === 200 && outcome.body && "effective" in outcome.body) {
      setView(outcome.body as AllowedOriginsView);
    }
    setLoaded(true);
  }, [connectionId]);

  useEffect(() => {
    void load();
  }, [load]);

  // A verified Allow or apply response counts even when the first load failed: it carries the
  // effective list and what RealTimeX holds, which is all the callout's state needs.
  const applyChange = useCallback(
    (change: AllowedOriginsChange) => {
      setView((current) => viewFromChange(current, change, { connectionId, sessionName }));
    },
    [connectionId, sessionName],
  );

  async function tryAgain(state: CalloutOriginState) {
    setBusy(true);
    try {
      if (state === "not_active") {
        const outcome = await allowedWebsitesApi.apply(connectionId);
        if ((outcome.status === 200 || outcome.status === 502) && outcome.body && "effective" in outcome.body) {
          applyChange(outcome.body as AllowedOriginsChange);
        }
      } else {
        await load();
      }
    } finally {
      setBusy(false);
    }
  }

  function openDialog(target: BlockedOrigin, opener: HTMLButtonElement) {
    openerRef.current = opener;
    focusCalloutOnClose.current = false;
    setDialog((current) => ({ key: (current?.key ?? 0) + 1, target }));
    setDialogOpen(true);
  }

  function handleAllowed(origin: string) {
    focusCalloutOnClose.current = true;
    setDialogOpen(false);
    setAnnouncement(`${origin} is allowed. Start the workflow again to use the link.`);
  }

  if (!loaded) return null;

  const states = origins.map((entry) => ({ ...entry, state: calloutOriginState(entry.origin, view) }));
  const allAllowed = states.every((entry) => entry.state === "allowed");
  const single = states.length === 1 ? states[0] : null;
  const tone = allAllowed ? "success" : "warning";
  const Icon = allAllowed ? CheckCircle2 : TriangleAlert;

  let title: string;
  let body: React.ReactNode;
  let action: React.ReactNode = null;

  const manage = (
    <Button variant="link" className="h-auto p-0 text-primary" asChild>
      <Link href={manageAllowedWebsitesHref(connectionId)}>Manage allowed websites</Link>
    </Button>
  );

  if (allAllowed) {
    title = single ? "Website allowed" : "Websites allowed";
    body = single ? (
      <p>
        <Mono>{sessionName}</Mono> can open <Mono>{single.origin}</Mono> now. Start the workflow again to use the
        link.
      </p>
    ) : (
      <p>
        <Mono>{sessionName}</Mono> can open these websites now. Start the workflow again to use them.
      </p>
    );
    action = manage;
  } else if (single && single.state === "not_active") {
    title = "Saved, but not active yet";
    body = (
      <p>
        The RealTimeX Browser didn&apos;t accept the update, so <Mono>{sessionName}</Mono> still can&apos;t open{" "}
        <Mono>{single.origin}</Mono>. Signals tries again the next time it uses this connection.
      </p>
    );
  } else if (single && single.state === "unreachable") {
    title = "Saved, but not active yet";
    body = (
      <p>
        Signals can&apos;t reach the RealTimeX Browser right now. <Mono>{single.origin}</Mono> is saved for{" "}
        <Mono>{sessionName}</Mono> and takes effect when the RealTimeX Browser is available.
      </p>
    );
  } else if (single) {
    title = "A website was blocked";
    body = (
      <>
        <p>
          The browser connection <Mono>{sessionName}</Mono> isn&apos;t allowed to open <Mono>{single.origin}</Mono>.
        </p>
        <BlockedLink url={single.requestedUrl} />
      </>
    );
  } else {
    title = `${states.length} websites were blocked`;
    body = (
      <p>
        The browser connection <Mono>{sessionName}</Mono> isn&apos;t allowed to open these websites.
      </p>
    );
  }

  if (single && !allAllowed) {
    action =
      single.state === "blocked" ? (
        <Button variant="outline" size="sm" onClick={(event) => openDialog(single, event.currentTarget)}>
          Allow website…
        </Button>
      ) : (
        <Button variant="outline" size="sm" disabled={busy} onClick={() => void tryAgain(single.state)}>
          {busy && <Loader2 className="animate-spin" aria-hidden />}
          Try again
        </Button>
      );
  }

  return (
    <div
      ref={calloutRef}
      tabIndex={-1}
      data-testid="blocked-website-callout"
      data-tone={tone}
      className={
        tone === "success"
          ? "rounded-lg border border-success/25 bg-success/10 p-4 text-sm text-success outline-none focus-visible:ring-2 focus-visible:ring-ring"
          : "rounded-lg border border-warning/30 bg-warning/10 p-4 text-sm text-warning outline-none focus-visible:ring-2 focus-visible:ring-ring"
      }
    >
      <div className="flex gap-3">
        <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <div className="min-w-0 flex-1 space-y-2">
          <p className="font-medium">{title}</p>
          {body}
          {!single && !allAllowed && (
            <ul className="divide-y divide-warning/20">
              {states.map((entry) => (
                <li key={entry.origin} className="flex flex-wrap items-center gap-2 py-2">
                  <div className="min-w-0 flex-1">
                    <Mono>{entry.origin}</Mono>
                    <BlockedLink url={entry.requestedUrl} />
                  </div>
                  {entry.state === "blocked" && (
                    <Button
                      variant="outline"
                      size="sm"
                      aria-label={`Allow ${entry.origin}…`}
                      onClick={(event) => openDialog(entry, event.currentTarget)}
                    >
                      Allow website…
                    </Button>
                  )}
                  {entry.state === "allowed" && <Badge variant="success">Allowed</Badge>}
                  {(entry.state === "not_active" || entry.state === "unreachable") && (
                    <>
                      <Badge variant="warning">Not active yet</Badge>
                      <Button variant="outline" size="sm" disabled={busy} onClick={() => void tryAgain(entry.state)}>
                        Try again
                      </Button>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
          {action && <div>{action}</div>}
          <p className="sr-only" role="status" aria-live="polite">
            {announcement}
          </p>
        </div>
      </div>

      {dialog && (
        <AllowWebsiteDialog
          key={dialog.key}
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          connectionId={connectionId}
          sessionName={sessionName}
          origin={dialog.target.origin}
          requestedUrl={dialog.target.requestedUrl}
          onChange={applyChange}
          onAllowed={handleAllowed}
          onCloseAutoFocus={() => {
            // The opener is gone when its row changed state (saved, not active yet).
            const opener = openerRef.current;
            if (!focusCalloutOnClose.current && opener?.isConnected) opener.focus();
            else calloutRef.current?.focus();
          }}
        />
      )}
    </div>
  );
}
