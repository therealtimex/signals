"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { CheckCircle, X } from "lucide-react";

const AUTO_DISMISS_MS = 10_000;

/**
 * Minimal success toast with one action button. The app has no global
 * toast system yet; this stays local so callers own placement and state.
 */
export function ActionToast({
  message,
  actionLabel,
  onAction,
  onDismiss,
}: {
  message: string;
  actionLabel: string;
  onAction: () => void;
  onDismiss: () => void;
}) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [onDismiss]);

  return (
    <div
      role="status"
      className="fixed bottom-4 right-4 z-50 flex items-center gap-3 rounded-lg border bg-background p-3 pr-2 text-sm shadow-lg"
    >
      <CheckCircle className="h-4 w-4 shrink-0 text-green-600" />
      <span>{message}</span>
      <Button size="sm" variant="outline" className="h-7 text-xs" onClick={onAction}>
        {actionLabel}
      </Button>
      <button
        type="button"
        aria-label="Dismiss"
        className="rounded p-1 text-muted-foreground hover:text-foreground"
        onClick={onDismiss}
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
