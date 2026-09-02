"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import type { WorkflowStep } from "@/lib/db/types";
import type { WorkflowRunProposalSummary } from "@/lib/writing/workflow-run-proposals";

const POLL_INTERVAL_MS = 2000;
const TERMINAL_STATUSES = ["completed", "failed", "cancelled"];

export interface ProgressData {
  run: {
    id: string;
    workflowType: string;
    status: string;
    totalItems: number | null;
    processedItems: number;
    successItems: number;
    skippedItems: number;
    errorItems: number;
    model: string | null;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
    startedAt: number | null;
    completedAt: number | null;
    config: string | null;
    errors: string | null;
    result: string | null;
  };
  steps: WorkflowStep[];
  isComplete: boolean;
  totalSteps: number;
  proposalSummary: WorkflowRunProposalSummary | null;
}

export function useWorkflowPolling(runId: string, initialStatus: string) {
  const [data, setData] = useState<ProgressData | null>(null);
  const [isPolling, setIsPolling] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stoppedRef = useRef(false);

  const shouldPoll = !TERMINAL_STATUSES.includes(initialStatus);

  const fetchProgress = useCallback(async () => {
    if (stoppedRef.current) return;
    try {
      const res = await fetch(`/api/workflows/${runId}/progress`);
      if (!res.ok) return;
      const json: ProgressData = await res.json();
      setData(json);

      if (json.isComplete) {
        stoppedRef.current = true;
        setIsPolling(false);
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
      }
    } catch {
      // Silently ignore — retries on next tick
    }
  }, [runId]);

  useEffect(() => {
    if (!shouldPoll) return;

    stoppedRef.current = false;
    setIsPolling(true);

    // Fetch immediately on mount
    fetchProgress();

    // Then poll every 2s
    intervalRef.current = setInterval(fetchProgress, POLL_INTERVAL_MS);

    return () => {
      stoppedRef.current = true;
      setIsPolling(false);
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [shouldPoll, fetchProgress]);

  return { data, isPolling };
}
