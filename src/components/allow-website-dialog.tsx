"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { allowedWebsitesApi, type ApiOutcome } from "@/lib/browser/allowed-websites-client";
import type {
  AddAllowedOriginResult,
  AllowedOriginsChange,
} from "@/lib/browser/allowed-websites-types";
import { NO_PUBLISHING_DIALOG } from "@/lib/browser/allowed-websites-ui";

/** What re-issuing the original request did, for the retry variant (contract §4). */
export type AllowWebsiteRetryOutcome =
  | { kind: "opened" }
  | { kind: "blocked"; origin: string; requestedUrl: string | null }
  | { kind: "failed"; reason: string };

type Target = { origin: string; requestedUrl: string | null };

type Phase =
  | { kind: "idle" }
  | { kind: "saving"; from: "allow" | "try_again" }
  | { kind: "opening" }
  | { kind: "not_active"; reachable: boolean }
  | { kind: "denied" }
  | { kind: "no_response" }
  | { kind: "page_failed"; reason: string };

export type AllowWebsiteDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  connectionId: string;
  sessionName: string;
  origin: string;
  requestedUrl: string | null;
  /** Every response that saved or re-applied the list, so the host's view stays current. */
  onChange: (change: AllowedOriginsChange) => void;
  /** The website is saved and active. The host closes the dialog and reports it. */
  onAllowed: (origin: string) => void;
  /** Re-issue the original request. Present only where the host can repeat it. */
  onRetry?: () => Promise<AllowWebsiteRetryOutcome>;
  /** Where focus goes when the dialog closes. */
  onCloseAutoFocus?: () => void;
};

function isChange(body: unknown): body is AllowedOriginsChange {
  return !!body && typeof body === "object" && "applied" in body && "effective" in body;
}

/**
 * Allow one website for one browser connection, from a blocked navigation (contract §3). Cancel,
 * Esc and an outside click send nothing; while saving they are ignored.
 */
export function AllowWebsiteDialog({
  open,
  onOpenChange,
  connectionId,
  sessionName,
  origin,
  requestedUrl,
  onChange,
  onAllowed,
  onRetry,
  onCloseAutoFocus,
}: AllowWebsiteDialogProps) {
  const [target, setTarget] = useState<Target>({ origin, requestedUrl });
  const [allowedBefore, setAllowedBefore] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const primaryRef = useRef<HTMLButtonElement>(null);
  const tryAgainRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const busy = phase.kind === "saving" || phase.kind === "opening";
  const retryVariant = Boolean(onRetry);

  useEffect(() => {
    if (phase.kind === "not_active" || phase.kind === "no_response" || phase.kind === "page_failed") {
      tryAgainRef.current?.focus();
    } else if (phase.kind === "denied") {
      closeRef.current?.focus();
    }
  }, [phase.kind]);

  async function reopenPage(allowedOrigin: string) {
    if (!onRetry) {
      onAllowed(allowedOrigin);
      return;
    }
    setPhase({ kind: "opening" });
    const outcome = await onRetry();
    if (outcome.kind === "opened") {
      onOpenChange(false);
    } else if (outcome.kind === "blocked") {
      setAllowedBefore(allowedOrigin);
      setTarget({ origin: outcome.origin, requestedUrl: outcome.requestedUrl });
      setPhase({ kind: "idle" });
      primaryRef.current?.focus();
    } else {
      setPhase({ kind: "page_failed", reason: outcome.reason });
    }
  }

  async function settle(outcome: ApiOutcome<AddAllowedOriginResult | AllowedOriginsChange>) {
    if (outcome.status === 403) {
      setPhase({ kind: "denied" });
      return;
    }
    if ((outcome.status === 200 || outcome.status === 502) && isChange(outcome.body)) {
      onChange(outcome.body);
      if (outcome.body.applied) {
        await reopenPage(target.origin);
      } else {
        setPhase({ kind: "not_active", reachable: outcome.body.runtime?.reachable === true });
      }
      return;
    }
    setPhase({ kind: "no_response" });
  }

  async function allow() {
    setPhase({ kind: "saving", from: "allow" });
    await settle(await allowedWebsitesApi.add(connectionId, target.origin, "recovery"));
  }

  async function tryAgain() {
    if (phase.kind === "page_failed") {
      await reopenPage(target.origin);
      return;
    }
    setPhase({ kind: "saving", from: "try_again" });
    const outcome =
      phase.kind === "not_active"
        ? await allowedWebsitesApi.apply(connectionId)
        : await allowedWebsitesApi.add(connectionId, target.origin, "recovery");
    await settle(outcome);
  }

  const primaryLabel = retryVariant ? "Allow website and retry" : "Allow website";
  const retrying = phase.kind === "saving" && phase.from === "try_again";
  const showPrimary = phase.kind === "idle" || phase.kind === "opening" || (phase.kind === "saving" && !retrying);

  return (
    <AlertDialog open={open} onOpenChange={(next) => (!busy || next) && onOpenChange(next)}>
      <AlertDialogContent
        onOverlayClick={() => !busy && onOpenChange(false)}
        onEscapeKeyDown={(event) => busy && event.preventDefault()}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          primaryRef.current?.focus();
        }}
        onCloseAutoFocus={(event) => {
          if (!onCloseAutoFocus) return;
          event.preventDefault();
          onCloseAutoFocus();
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>{allowedBefore ? "Allow another website?" : "Allow this website?"}</AlertDialogTitle>
          <AlertDialogDescription>
            The browser connection <code className="font-mono text-foreground">{sessionName}</code> will be
            able to open pages on:
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="space-y-3 min-w-0">
          {allowedBefore && (
            <p className="text-sm text-success break-words [overflow-wrap:anywhere]">
              {allowedBefore} is allowed. Opening the page then needed another website, which is also blocked.
            </p>
          )}
          <p
            className="rounded-md border bg-muted/40 px-3 py-2 font-mono text-sm break-words [overflow-wrap:anywhere]"
            data-testid="allow-website-origin"
          >
            {target.origin}
          </p>
          {target.requestedUrl && (
            <p className="text-xs text-muted-foreground break-words [overflow-wrap:anywhere]">
              Blocked link: {target.requestedUrl}
            </p>
          )}
          <p className="text-xs text-muted-foreground">{NO_PUBLISHING_DIALOG}</p>

          {phase.kind === "not_active" && (
            <div role="alert" className="rounded-md border border-warning/30 bg-warning/10 p-3 text-sm text-warning">
              <p className="font-medium">Saved, but not active yet</p>
              <p>
                {phase.reachable
                  ? retryVariant
                    ? "The RealTimeX Browser didn't accept the update, so the page wasn't opened. Signals tries again the next time it uses this connection."
                    : "The RealTimeX Browser didn't accept the update. Signals tries again the next time it uses this connection."
                  : "Signals can't reach the RealTimeX Browser right now. The website is saved and takes effect when the RealTimeX Browser is available."}
              </p>
            </div>
          )}
          {phase.kind === "denied" && (
            <div role="alert" className="rounded-md border border-danger/25 bg-danger/10 p-3 text-sm text-danger">
              <p className="font-medium">Can&apos;t change signals-publish</p>
              <p>This development copy of Signals can&apos;t change the shared publishing connection. Nothing was saved.</p>
            </div>
          )}
          {phase.kind === "no_response" && (
            <div role="alert" className="rounded-md border border-danger/25 bg-danger/10 p-3 text-sm text-danger">
              <p className="font-medium">Couldn&apos;t allow the website</p>
              <p>Signals didn&apos;t respond. Nothing was saved.</p>
            </div>
          )}
          {phase.kind === "page_failed" && (
            <div role="alert" className="rounded-md border border-danger/25 bg-danger/10 p-3 text-sm text-danger">
              <p className="font-medium">The page didn&apos;t open</p>
              <p className="break-words [overflow-wrap:anywhere]">
                {target.origin} is allowed, but opening the page failed: {phase.reason}.
              </p>
            </div>
          )}
        </div>

        <AlertDialogFooter>
          {showPrimary ? (
            <>
              <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
              <Button ref={primaryRef} onClick={() => void allow()} disabled={busy} aria-busy={busy}>
                {busy && <Loader2 className="animate-spin" aria-hidden />}
                {phase.kind === "saving" ? "Allowing…" : phase.kind === "opening" ? "Opening…" : primaryLabel}
              </Button>
            </>
          ) : (
            <>
              <AlertDialogCancel ref={closeRef} disabled={busy}>
                Close
              </AlertDialogCancel>
              {phase.kind !== "denied" && (
                <Button ref={tryAgainRef} onClick={() => void tryAgain()} disabled={busy} aria-busy={busy}>
                  {retrying && <Loader2 className="animate-spin" aria-hidden />}
                  Try again
                </Button>
              )}
            </>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
