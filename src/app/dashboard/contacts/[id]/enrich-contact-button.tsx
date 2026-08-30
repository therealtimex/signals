"use client";

import { useCallback, useEffect, useRef, useState, type ComponentProps } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ContactWebResearchState } from "@/lib/contacts/web-research-state";

const idle: ContactWebResearchState = {
  status: "idle",
  workflowRunId: null,
  lastRunAt: null,
  fieldsUpdated: [],
  unresolvedFields: [],
  identityLinked: false,
  visitedUrls: [],
  blockedUrls: [],
  ambiguous: false,
  serpCandidates: [],
  message: null,
};

type EnrichContactButtonProps = {
  contactId: string;
  needsWebResearch: boolean;
  profilePipelineTemplateId: string | null;
  disabled?: boolean;
  variant?: ComponentProps<typeof Button>["variant"];
  size?: ComponentProps<typeof Button>["size"];
};

export function EnrichContactButton({
  contactId,
  needsWebResearch,
  profilePipelineTemplateId,
  disabled = false,
  variant = "default",
  size = "sm",
}: EnrichContactButtonProps) {
  const router = useRouter();
  const [state, setState] = useState<ContactWebResearchState>(idle);
  const [pipelineRunning, setPipelineRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [repairHref, setRepairHref] = useState<string | null>(null);
  const statusRef = useRef<ContactWebResearchState["status"]>("idle");

  const refresh = useCallback(async () => {
    if (!needsWebResearch) return;
    const response = await fetch(`/api/contacts/${contactId}/web-research`);
    if (!response.ok) return;
    const next = (await response.json()) as ContactWebResearchState;
    if (statusRef.current === "pending" && next.status !== "pending") {
      router.refresh();
    }
    statusRef.current = next.status;
    setState(next);
  }, [contactId, needsWebResearch, router]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!needsWebResearch || state.status !== "pending") return;
    const interval = window.setInterval(() => void refresh(), 5_000);
    return () => window.clearInterval(interval);
  }, [needsWebResearch, refresh, state.status]);

  async function startWebResearch() {
    setError(null);
    setRepairHref(null);
    statusRef.current = "pending";
    setState((current) => ({ ...current, status: "pending" }));
    const response = await fetch(`/api/contacts/${contactId}/web-research`, { method: "POST" });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      statusRef.current = "failed";
      setState((current) => ({ ...current, status: "failed" }));
      setError(typeof body.error === "string" ? body.error : "Could not start enrichment.");
      if (body.code === "RESEARCH_TARGET_UNAVAILABLE") {
        const details = body.details as Record<string, unknown> | undefined;
        setRepairHref(
          typeof details?.settingsPath === "string"
            ? details.settingsPath
            : "/dashboard/settings?tab=platforms",
        );
      }
      return;
    }
    await refresh();
  }

  async function startProfilePipeline() {
    if (!profilePipelineTemplateId) return;
    setPipelineRunning(true);
    setError(null);
    setRepairHref(null);
    try {
      const response = await fetch(`/api/workflows/templates/${profilePipelineTemplateId}/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config: { contactIds: [contactId] } }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setError(
          typeof body.error === "string" ? body.error : "Failed to start profile pipeline",
        );
        return;
      }
      const body = await response.json().catch(() => ({}));
      if (typeof body.workflowRunId === "string") {
        router.push(`/dashboard/workflows/${body.workflowRunId}`);
      }
    } catch {
      setError("Failed to start profile pipeline");
    } finally {
      setPipelineRunning(false);
    }
  }

  const pending = needsWebResearch ? state.status === "pending" : pipelineRunning;
  const label = pending
    ? "Enriching…"
    : needsWebResearch && state.status === "partial"
      ? "Continue enrichment"
      : needsWebResearch && state.status === "failed"
        ? "Retry enrichment"
        : "Enrich profile";
  const route = needsWebResearch ? "web-research" : "profile-pipeline";

  return (
    <div className="flex flex-col items-start gap-1">
      <Button
        variant={variant}
        size={size}
        onClick={() => void (needsWebResearch ? startWebResearch() : startProfilePipeline())}
        disabled={disabled || pending || (!needsWebResearch && !profilePipelineTemplateId)}
        data-enrichment-route={route}
      >
        {pending ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <Sparkles className="size-3.5" />
        )}
        {label}
      </Button>
      {needsWebResearch && state.status === "partial" && state.unresolvedFields.length > 0 ? (
        <p className="max-w-56 text-xs text-amber-700">
          Still missing: {state.unresolvedFields.join(", ")}
        </p>
      ) : null}
      {error ? (
        <div className="max-w-56 text-xs text-destructive" role="alert">
          <p>{error}</p>
          {repairHref ? (
            <Link className="font-medium underline underline-offset-2" href={repairHref}>
              Open Platform connections
            </Link>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
