"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { OrgEnrichmentState } from "@/lib/orgs/enrichment";

const idle: OrgEnrichmentState = {
  status: "idle",
  workflowRunId: null,
  lastRunAt: null,
  fieldsUpdated: [],
  unresolvedFields: [],
  message: null,
};

export function EnrichCompanyButton({ orgId }: { orgId: string }) {
  const [state, setState] = useState<OrgEnrichmentState>(idle);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const response = await fetch(`/api/orgs/${orgId}/enrichment`);
    if (response.ok) setState((await response.json()) as OrgEnrichmentState);
  }, [orgId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (state.status !== "pending") return;
    const interval = window.setInterval(() => void refresh(), 5_000);
    return () => window.clearInterval(interval);
  }, [refresh, state.status]);

  async function start() {
    setError(null);
    setState((current) => ({ ...current, status: "pending" }));
    const response = await fetch(`/api/orgs/${orgId}/enrich`, { method: "POST" });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      setState((current) => ({ ...current, status: "failed" }));
      setError(typeof body.error === "string" ? body.error : "Could not start enrichment.");
      return;
    }
    await refresh();
  }

  const label =
    state.status === "pending"
      ? "Enriching…"
      : state.status === "partial"
        ? "Continue enrichment"
        : state.status === "failed"
          ? "Retry enrichment"
          : "Enrich company";

  return (
    <div className="flex flex-col items-start gap-1">
      <Button variant="outline" size="sm" onClick={start} disabled={state.status === "pending"}>
        {state.status === "pending" ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <Sparkles className="size-3.5 text-primary" />
        )}
        {label}
      </Button>
      {state.status === "partial" && state.unresolvedFields.length > 0 ? (
        <p className="max-w-56 text-xs text-amber-700">
          Still missing: {state.unresolvedFields.join(", ")}
        </p>
      ) : null}
      {error ? <p className="max-w-56 text-xs text-destructive" role="alert">{error}</p> : null}
    </div>
  );
}
