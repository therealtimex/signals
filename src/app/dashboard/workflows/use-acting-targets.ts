"use client";

import { useEffect, useState } from "react";

export type ActingTarget = {
  id: string;
  platform: string;
  name: string;
  handle: string | null;
  status: string;
};

/**
 * Active acting profiles available to a workflow run.
 *
 * `null` means still loading — an empty array is a real answer ("nothing connected"), and the
 * activate dialog renders a different hint for each.
 */
export function useActingTargets(): ActingTarget[] | null {
  const [targets, setTargets] = useState<ActingTarget[] | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/platform-targets", { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data: { targets?: ActingTarget[] }) => {
        setTargets((data.targets ?? []).filter((t) => t.status === "active"));
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setTargets([]);
      });
    return () => controller.abort();
  }, []);

  return targets;
}
