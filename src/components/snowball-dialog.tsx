"use client";

import { useState } from "react";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2, Sparkles, X } from "lucide-react";
import Link from "next/link";
import { NetworkSnowballFields } from "@/app/dashboard/workflows/network-snowball-fields";
import {
  buildNetworkSnowballRunConfig,
  buildNetworkSnowballTemplateConfig,
  NETWORK_SNOWBALL_TEMPLATE_NAME,
  readNetworkSnowballConfig,
  type NetworkSnowballConfig,
  type SnowballSeedType,
} from "@/lib/workflows/network-snowball";

interface SnowballDialogProps {
  open: boolean;
  onClose: () => void;
  seedType: SnowballSeedType;
  seedValue: string;
  entityName: string;
}

export function SnowballDialog({
  open,
  onClose,
  seedType,
  seedValue,
  entityName,
}: SnowballDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      {open && (
        <SnowballDialogContent
          key={`${seedType}-${seedValue}`}
          onClose={onClose}
          seedType={seedType}
          seedValue={seedValue}
          entityName={entityName}
        />
      )}
    </Dialog>
  );
}

function SnowballDialogContent({
  onClose,
  seedType,
  seedValue,
  entityName,
}: {
  onClose: () => void;
  seedType: SnowballSeedType;
  seedValue: string;
  entityName: string;
}) {
  const [config, setConfig] = useState<NetworkSnowballConfig>(() =>
    readNetworkSnowballConfig({
      ...buildNetworkSnowballTemplateConfig(),
      seedType,
      seedValue,
    }),
  );
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [workflowRunId, setWorkflowRunId] = useState<string | null>(null);
  const [threadPath, setThreadPath] = useState<string | null>(null);

  async function handleLaunch() {
    setRunning(true);
    setError(null);

    try {
      // 1. Locate the Network Snowball template
      const templatesRes = await fetch("/api/workflows/templates?isSystem=true&pageSize=50");
      if (!templatesRes.ok) throw new Error("Failed to load workflow templates");
      const templatesPayload = (await templatesRes.json()) as {
        data?: Array<{ id: string; name: string }>;
      };
      const template = (templatesPayload.data ?? []).find(
        (t) => t.name === NETWORK_SNOWBALL_TEMPLATE_NAME,
      );

      if (!template) {
        throw new Error("Network Snowball template not found. Please re-seed templates.");
      }

      // 2. Launch the workflow run
      const runRes = await fetch(`/api/workflows/templates/${template.id}/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          config: buildNetworkSnowballRunConfig(config),
        }),
      });

      if (!runRes.ok) {
        const errData = await runRes.json().catch(() => ({}));
        throw new Error(typeof errData.error === "string" ? errData.error : "Failed to launch snowball agent");
      }

      const runData = (await runRes.json()) as {
        workflowRunId?: string;
        threadPath?: string;
      };

      setWorkflowRunId(runData.workflowRunId ?? null);
      setThreadPath(runData.threadPath ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to launch snowball run");
    } finally {
      setRunning(false);
    }
  }

  const runLaunched = Boolean(workflowRunId || threadPath);

  return (
    <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col p-0 gap-0">
      <div className="p-6 pb-4 border-b shrink-0 space-y-1.5">
        <div className="flex items-center justify-between">
          <DialogTitle className="text-xl flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            Snowball Network: {entityName}
          </DialogTitle>
          <DialogClose asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 rounded-md opacity-70 hover:opacity-100 -mr-2"
              onClick={onClose}
            >
              <X className="h-4 w-4" />
              <span className="sr-only">Close</span>
            </Button>
          </DialogClose>
        </div>
        <DialogDescription className="text-sm text-muted-foreground">
          Traverse causal edges to discover and link connected investors, co-founders, angels, and technical advocates into the Signals graph.
        </DialogDescription>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        {runLaunched ? (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-100 space-y-2">
            <p className="font-medium">Snowball agent launched in RealTimeX!</p>
            <p className="text-xs text-muted-foreground">
              The agent is inspecting live feeds and traversing relationship edges.
            </p>
            {workflowRunId && (
              <div className="pt-2">
                <Link
                  href={`/dashboard/workflows/${workflowRunId}`}
                  className="inline-flex items-center justify-center rounded-md bg-emerald-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-800"
                  onClick={onClose}
                >
                  View Live Run & Thread
                </Link>
              </div>
            )}
            {threadPath && <p className="font-mono text-xs text-muted-foreground pt-1">{threadPath}</p>}
          </div>
        ) : (
          <NetworkSnowballFields
            value={config}
            onChange={setConfig}
            disabled={running}
          />
        )}

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
            {error}
          </div>
        )}
      </div>

      <div className="p-4 px-6 border-t shrink-0 bg-background/95 backdrop-blur flex justify-end gap-2">
        <Button variant="outline" onClick={onClose} disabled={running}>
          {runLaunched ? "Close" : "Cancel"}
        </Button>
        {!runLaunched && (
          <Button onClick={handleLaunch} disabled={running || !config.seedValue.trim()}>
            {running ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Launching Snowball…
              </>
            ) : (
              <>
                <Sparkles className="mr-2 h-4 w-4" />
                Launch Snowball Run
              </>
            )}
          </Button>
        )}
      </div>
    </DialogContent>
  );
}
