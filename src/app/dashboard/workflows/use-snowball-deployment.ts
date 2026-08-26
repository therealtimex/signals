"use client";

import { useEffect, useState } from "react";

export type SnowballDeploymentLoad =
  | { status: "loading" }
  | { status: "ready"; deployment: Record<string, unknown> | null }
  | { status: "error"; error: string };

/**
 * Current Snowball Seed Scout deployment, or `null` when nothing is deployed.
 *
 * Mirrors `useActingTargets`: the request is aborted on unmount so closing the
 * dialog mid-flight cannot settle state on a torn-down component, and a failed
 * lookup is surfaced rather than being mistaken for "not deployed".
 */
export function useSnowballDeployment(templateId: string): SnowballDeploymentLoad {
  const [load, setLoad] = useState<SnowballDeploymentLoad>({ status: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    setLoad({ status: "loading" });

    fetch("/api/snowball-seed-scout/deployment", { signal: controller.signal })
      .then((res) => {
        if (!res.ok) {
          throw new Error(`Deployment lookup failed (${res.status})`);
        }
        return res.json();
      })
      .then((payload: { deployment?: Record<string, unknown> | null }) => {
        setLoad({ status: "ready", deployment: payload.deployment ?? null });
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setLoad({ status: "error", error: "Failed to load deployment status" });
      });

    return () => controller.abort();
  }, [templateId]);

  return load;
}
