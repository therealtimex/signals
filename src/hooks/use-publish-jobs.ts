"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PublishJobTarget, PublishPlatformTarget } from "@/lib/publish/types";

export type PublishJobSummary = {
  id: string;
  contentItemId: string;
  status: string;
  targets: PublishJobTarget[];
  payload: {
    text: string;
    platforms: PublishPlatformTarget[];
    mediaAssetIds: string[];
  };
  rtxWorkspaceSlug: string | null;
  rtxThreadSlug: string | null;
  stale: boolean;
  threadPath: string | null;
  error?: string | null;
  errorCode?: string | null;
};

const POLL_MS = 5000;

export function usePublishJobs(contentItemIds: string[]) {
  const [jobsByItemId, setJobsByItemId] = useState<Record<string, PublishJobSummary | null>>({});
  const fetchJobs = useCallback(async () => {
    if (contentItemIds.length === 0) return;

    const results = await Promise.all(
      contentItemIds.map(async (id) => {
        try {
          const res = await fetch(`/api/content/publish-jobs?contentItemId=${encodeURIComponent(id)}`);
          if (!res.ok) return [id, null] as const;
          const data = await res.json();
          const latest = (data.jobs?.[0] ?? null) as PublishJobSummary | null;
          return [id, latest] as const;
        } catch {
          return [id, null] as const;
        }
      })
    );

    setJobsByItemId((prev) => {
      const next = { ...prev };
      for (const [id, job] of results) {
        next[id] = job;
      }
      return next;
    });
  }, [contentItemIds]);

  const prevTerminalRef = useRef<Set<string>>(new Set());

  const needsPolling = contentItemIds.some((id) => {
    const job = jobsByItemId[id];
    return job?.status === "queued" || job?.status === "publishing";
  });

  useEffect(() => {
    void fetchJobs();
  }, [fetchJobs]);

  useEffect(() => {
    if (!needsPolling) return;
    const timer = setInterval(() => void fetchJobs(), POLL_MS);
    return () => clearInterval(timer);
  }, [needsPolling, fetchJobs]);

  const checkTerminalTransitions = useCallback(
    (onTerminal: () => void) => {
      const terminal = new Set<string>();
      for (const id of contentItemIds) {
        const job = jobsByItemId[id];
        if (
          job &&
          (job.status === "completed" ||
            job.status === "partial" ||
            job.status === "failed" ||
            job.status === "superseded")
        ) {
          terminal.add(id);
        }
      }
      const prev = prevTerminalRef.current;
      let transitioned = false;
      for (const id of terminal) {
        if (!prev.has(id)) {
          const job = jobsByItemId[id];
          if (job && (job.status === "completed" || job.status === "partial" || job.status === "failed")) {
            transitioned = true;
          }
        }
      }
      prevTerminalRef.current = terminal;
      if (transitioned) onTerminal();
    },
    [contentItemIds, jobsByItemId]
  );

  return { jobsByItemId, fetchJobs, checkTerminalTransitions };
}
