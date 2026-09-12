"use client";

import { useReducer, useState } from "react";
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
  buildNetworkSnowballTemplateConfig,
  NETWORK_SNOWBALL_TEMPLATE_NAME,
  readNetworkSnowballConfig,
  type NetworkSnowballConfig,
  type SnowballSeedType,
} from "@/lib/workflows/network-snowball";
import { buildSnowballDialogRunConfig } from "./snowball-dialog-config";
import { EventParticipantReport } from "@/components/event-participant-report";

interface SnowballDialogProps {
  open: boolean;
  onClose: () => void;
  seedType: SnowballSeedType;
  seedValue: string;
  entityName: string;
  orgId?: string;
}

type SnowballLaunchState = {
  running: boolean;
  error: string | null;
  workflowRunId: string | null;
  threadPath: string | null;
  eventReportCapability: string | null;
};

type SnowballLaunchAction =
  | { type: "start" }
  | {
      type: "success";
      workflowRunId?: string;
      threadPath?: string;
      eventReportCapability?: string;
    }
  | {
      type: "failure";
      error: string;
      workflowRunId?: string;
      eventReportCapability?: string;
    };

const INITIAL_LAUNCH_STATE: SnowballLaunchState = {
  running: false,
  error: null,
  workflowRunId: null,
  threadPath: null,
  eventReportCapability: null,
};

function launchReducer(
  _state: SnowballLaunchState,
  action: SnowballLaunchAction,
): SnowballLaunchState {
  if (action.type === "start") return { ...INITIAL_LAUNCH_STATE, running: true };
  if (action.type === "success") {
    return {
      running: false,
      error: null,
      workflowRunId: action.workflowRunId ?? null,
      threadPath: action.threadPath ?? null,
      eventReportCapability: action.eventReportCapability ?? null,
    };
  }
  return {
    running: false,
    error: action.error,
    workflowRunId: action.workflowRunId ?? null,
    threadPath: null,
    eventReportCapability: action.eventReportCapability ?? null,
  };
}

async function requestSnowballLaunch(
  config: NetworkSnowballConfig,
  orgId?: string,
): Promise<Exclude<SnowballLaunchAction, { type: "start" }>> {
  const templatesRes = await fetch("/api/workflows/templates?isSystem=true&pageSize=50");
  if (!templatesRes.ok) return { type: "failure", error: "Failed to load workflow templates" };
  const templatesPayload = (await templatesRes.json()) as {
    data?: Array<{ id: string; name: string }>;
  };
  const template = (templatesPayload.data ?? []).find(
    (candidate) => candidate.name === NETWORK_SNOWBALL_TEMPLATE_NAME,
  );
  if (!template) {
    return {
      type: "failure",
      error: "Network Snowball template not found. Please re-seed templates.",
    };
  }

  const runRes = await fetch(`/api/workflows/templates/${template.id}/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ config: buildSnowballDialogRunConfig(config, orgId) }),
  });
  if (!runRes.ok) {
    const errorData = (await runRes.json().catch(() => ({}))) as {
      error?: unknown;
      workflowRunId?: string;
      eventReportCapability?: { token?: string };
    };
    return {
      type: "failure",
      error: typeof errorData.error === "string"
        ? errorData.error
        : "Failed to launch snowball agent",
      workflowRunId: errorData.workflowRunId,
      eventReportCapability: errorData.eventReportCapability?.token,
    };
  }
  const runData = (await runRes.json()) as {
    workflowRunId?: string;
    threadPath?: string;
    eventReportCapability?: { token?: string };
  };
  return {
    type: "success",
    workflowRunId: runData.workflowRunId,
    threadPath: runData.threadPath,
    eventReportCapability: runData.eventReportCapability?.token,
  };
}

export function SnowballDialog({
  open,
  onClose,
  seedType,
  seedValue,
  entityName,
  orgId,
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
          orgId={orgId}
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
  orgId,
}: {
  onClose: () => void;
  seedType: SnowballSeedType;
  seedValue: string;
  entityName: string;
  orgId?: string;
}) {
  const [config, setConfig] = useState<NetworkSnowballConfig>(() =>
    readNetworkSnowballConfig({
      ...buildNetworkSnowballTemplateConfig(),
      seedType,
      seedValue,
    }),
  );
  const [{ running, error, workflowRunId, threadPath, eventReportCapability }, dispatchLaunch] =
    useReducer(launchReducer, INITIAL_LAUNCH_STATE);

  async function handleLaunch() {
    dispatchLaunch({ type: "start" });
    try {
      dispatchLaunch(await requestSnowballLaunch(config, orgId));
    } catch (err) {
      dispatchLaunch({
        type: "failure",
        error: err instanceof Error ? err.message : "Failed to launch snowball run",
      });
    }
  }

  const runLaunched = !error && Boolean(workflowRunId || threadPath);

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

      <SnowballDialogBody
        config={config}
        setConfig={setConfig}
        running={running}
        error={error}
        workflowRunId={workflowRunId}
        threadPath={threadPath}
        eventReportCapability={eventReportCapability}
        runLaunched={runLaunched}
        onClose={onClose}
      />
      <SnowballDialogFooter
        config={config}
        running={running}
        runLaunched={runLaunched}
        onClose={onClose}
        onLaunch={handleLaunch}
      />
    </DialogContent>
  );
}

function SnowballDialogBody({
  config,
  setConfig,
  running,
  error,
  workflowRunId,
  threadPath,
  eventReportCapability,
  runLaunched,
  onClose,
}: {
  config: NetworkSnowballConfig;
  setConfig: (value: NetworkSnowballConfig) => void;
  running: boolean;
  error: string | null;
  workflowRunId: string | null;
  threadPath: string | null;
  eventReportCapability: string | null;
  runLaunched: boolean;
  onClose: () => void;
}) {
  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-4">
      {runLaunched ? (
        <SnowballLaunchSuccess
          workflowRunId={workflowRunId}
          threadPath={threadPath}
          eventReportCapability={eventReportCapability}
          onClose={onClose}
        />
      ) : (
        <NetworkSnowballFields value={config} onChange={setConfig} disabled={running} />
      )}
      <SnowballLaunchError
        error={error}
        workflowRunId={workflowRunId}
        eventReportCapability={eventReportCapability}
      />
    </div>
  );
}

function SnowballLaunchSuccess({
  workflowRunId,
  threadPath,
  eventReportCapability,
  onClose,
}: {
  workflowRunId: string | null;
  threadPath: string | null;
  eventReportCapability: string | null;
  onClose: () => void;
}) {
  return (
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
      {workflowRunId && eventReportCapability && (
        <EventParticipantReport
          workflowRunId={workflowRunId}
          capability={eventReportCapability}
        />
      )}
    </div>
  );
}

function SnowballLaunchError({
  error,
  workflowRunId,
  eventReportCapability,
}: {
  error: string | null;
  workflowRunId: string | null;
  eventReportCapability: string | null;
}) {
  if (!error) return null;
  return (
    <div className="space-y-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
      <p>{error}</p>
      {workflowRunId && eventReportCapability && (
        <EventParticipantReport
          workflowRunId={workflowRunId}
          capability={eventReportCapability}
        />
      )}
    </div>
  );
}

function SnowballDialogFooter({
  config,
  running,
  runLaunched,
  onClose,
  onLaunch,
}: {
  config: NetworkSnowballConfig;
  running: boolean;
  runLaunched: boolean;
  onClose: () => void;
  onLaunch: () => void;
}) {
  const launchDisabled =
    running ||
    !config.seedValue.trim() ||
    (config.participantAccess.enabled && !config.participantAccess.browserSessionName.trim());
  return (
    <div className="p-4 px-6 border-t shrink-0 bg-background/95 backdrop-blur flex justify-end gap-2">
      <Button variant="outline" onClick={onClose} disabled={running}>
        {runLaunched ? "Close" : "Cancel"}
      </Button>
      {!runLaunched && (
        <Button onClick={onLaunch} disabled={launchDisabled}>
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
  );
}
