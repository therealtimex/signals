"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, Sparkles } from "lucide-react";

interface SyncResult {
  added: number;
  updated: number;
  skipped: number;
  errors: string[];
}

interface EnrichButtonProps {
  /** Single contact enrichment. */
  contactId?: string;
  /** Bulk enrichment (overrides contactId). */
  contactIds?: string[];
  /** Max profiles per batch. */
  maxProfiles?: number;
  variant?: "default" | "outline" | "ghost";
  size?: "default" | "sm" | "icon";
  onComplete?: (result: SyncResult) => void;
}

export function EnrichButton({
  contactId,
  contactIds,
  maxProfiles,
  variant = "outline",
  size = "sm",
  onComplete,
}: EnrichButtonProps) {
  const [enriching, setEnriching] = useState(false);
  const [result, setResult] = useState<SyncResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleEnrich() {
    setEnriching(true);
    setResult(null);
    setError(null);

    try {
      const ids = contactIds ?? (contactId ? [contactId] : undefined);

      const res = await fetch("/api/platforms/x/enrich", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contactIds: ids,
          maxProfiles,
        }),
      });

      const data = await res.json();

      if (!res.ok && !data.delegated) {
        setError(data.error || "Enrichment runs via RealTimeX agent-browser (see docs/rtx-agent-browser-enrichment.md)");
        return;
      }

      if (data.delegated) {
        setError(data.message || "Enrichment runs via RealTimeX agent-browser (see docs/rtx-agent-browser-enrichment.md)");
        return;
      }

      setResult(data.result);
      onComplete?.(data.result);
    } catch {
      setError("Enrichment failed");
    } finally {
      setEnriching(false);
    }
  }

  const isBulk = !contactId && !contactIds;

  return (
    <div className="inline-flex flex-col items-start gap-1">
      <Button
        variant={variant}
        size={size}
        onClick={handleEnrich}
        disabled={enriching}
      >
        {enriching ? (
          <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
        ) : (
          <Sparkles className="mr-1.5 h-3.5 w-3.5" />
        )}
        {enriching
          ? "Loading..."
          : isBulk
            ? "Low-score (RTX)"
            : "RTX enrich"}
      </Button>

      {error && (
        <p className="text-xs text-destructive">{error}</p>
      )}

      {result && (
        <p className="text-xs text-muted-foreground">
          {result.updated > 0
            ? `Updated ${result.updated} contact${result.updated !== 1 ? "s" : ""}`
            : "No new data found"}
          {result.errors.length > 0 && ` (${result.errors.length} error${result.errors.length !== 1 ? "s" : ""})`}
        </p>
      )}
    </div>
  );
}
