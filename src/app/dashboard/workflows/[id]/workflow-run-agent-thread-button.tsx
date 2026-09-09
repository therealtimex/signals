"use client";

import { useState } from "react";
import { ExternalLink, Loader2, MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { WorkflowRunAgentThread } from "@/lib/workflows/workflow-run-agent-thread";

const TERMINAL_RUN_STATUSES = new Set(["completed", "failed", "cancelled"]);

export function WorkflowRunAgentThreadButton({
  runId,
  runStatus,
  agentThread,
  compact = false,
}: {
  runId: string;
  runStatus: string;
  agentThread: WorkflowRunAgentThread;
  compact?: boolean;
}) {
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (agentThread.state === "none" || (compact && agentThread.state !== "available")) {
    return null;
  }

  const isConnecting = agentThread.state === "connecting";
  const label = compact
    ? "Open thread"
    : isConnecting
      ? "Connecting…"
      : TERMINAL_RUN_STATUSES.has(runStatus)
        ? "View agent thread"
        : "Agent thread";

  async function openThread() {
    if (agentThread.state !== "available") return;
    setOpening(true);
    setError(null);
    try {
      const response = await fetch(`/api/workflows/runs/${runId}/open-thread`, {
        method: "POST",
      });
      if (!response.ok) {
        throw new Error(`Could not open the agent thread (${response.status})`);
      }
      const body = (await response.json().catch(() => ({}))) as {
        success?: boolean;
        error?: string;
      };
      if (body.success !== true) {
        throw new Error(body.error || "Could not open the agent thread");
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not open the agent thread");
    } finally {
      setOpening(false);
    }
  }

  return (
    <span className="inline-flex flex-col items-end gap-1">
      <Button
        type="button"
        variant="outline"
        size={compact ? "xs" : "sm"}
        className={compact ? "rounded-full" : "h-7 rounded-full text-xs"}
        disabled={isConnecting || opening}
        aria-label={label}
        title={agentThread.state === "available" ? agentThread.threadPath : undefined}
        onClick={() => void openThread()}
      >
        {isConnecting || opening ? (
          <Loader2 className="animate-spin" />
        ) : (
          <MessageSquare />
        )}
        {opening ? "Opening…" : label}
        {!isConnecting && !opening ? <ExternalLink /> : null}
      </Button>
      {error ? (
        <span role="alert" className="max-w-64 text-right text-[10px] text-destructive">
          {error}
        </span>
      ) : null}
    </span>
  );
}
