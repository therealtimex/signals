"use client";

import { useReducer, useEffect, useRef } from "react";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Loader2, Play, X } from "lucide-react";
import Link from "next/link";
import {
  PROFILE_PIPELINE_DEFAULT_BATCH,
  PROFILE_PIPELINE_MAX_BATCH,
  clampPipelineBatchSize,
  readRunLimitFromTemplateConfig,
} from "@/app/dashboard/workflows/activate-dialog.utils";
import { SocialPatrolFields } from "@/app/dashboard/workflows/social-patrol-fields";
import { ProfilePublishFields } from "@/app/dashboard/workflows/profile-publish-fields";
import { ContactNurtureFields } from "@/app/dashboard/workflows/contact-nurture-fields";
import {
  buildSocialPatrolRunConfig,
  isSocialPatrolTemplateConfig,
  readSocialPatrolConfig,
} from "@/lib/workflows/social-patrol";
import {
  buildProfilePublishRunConfig,
  isProfilePublishTemplateConfig,
  readProfilePublishConfig,
} from "@/lib/workflows/profile-publish";
import {
  buildContactNurtureRunConfig,
  isContactNurtureTemplateConfig,
  readContactNurtureConfig,
} from "@/lib/workflows/contact-relationship-nurture";

interface Template {
  id: string;
  name: string;
  description: string | null;
  templateType: string;
  systemPrompt: string | null;
  targetPersona: string | null;
  config: string;
}

interface ActivateDialogProps {
  template: Template;
  open: boolean;
  onClose: () => void;
}

type PipelineBacklogPreview = {
  backlogTotal: number;
  batchSize: number;
};

function parseTemplateConfig(config: string): Record<string, unknown> {
  try {
    return JSON.parse(config || "{}") as Record<string, unknown>;
  } catch {
    return {};
  }
}

function isPipelineTemplateConfig(config: string): boolean {
  return Boolean(parseTemplateConfig(config).pipeline);
}

interface DialogState {
  running: boolean;
  error: string | null;
  threadPath: string | null;
  workflowRunId: string | null;
  backlog: PipelineBacklogPreview | null;
  backlogLoading: boolean;
  pipelineBatchSize: number;
  freshThread: boolean;
  systemPrompt: string;
  patrol: ReturnType<typeof readSocialPatrolConfig>;
  profilePublish: ReturnType<typeof readProfilePublishConfig>;
  contactNurture: ReturnType<typeof readContactNurtureConfig>;
  limits: ReturnType<typeof readRunLimitFromTemplateConfig>;
}

type DialogAction =
  | { type: "START_RUN" }
  | { type: "RUN_SUCCESS"; workflowRunId?: string; threadPath?: string }
  | { type: "RUN_ERROR"; error: string }
  | { type: "SET_BACKLOG_LOADING"; loading: boolean }
  | { type: "SET_BACKLOG"; backlog: PipelineBacklogPreview | null; batchSize?: number }
  | { type: "SET_PIPELINE_BATCH_SIZE"; batchSize: number }
  | { type: "SET_FRESH_THREAD"; freshThread: boolean }
  | { type: "SET_SYSTEM_PROMPT"; systemPrompt: string }
  | { type: "SET_PATROL"; patrol: ReturnType<typeof readSocialPatrolConfig> }
  | { type: "SET_PROFILE_PUBLISH"; profilePublish: ReturnType<typeof readProfilePublishConfig> }
  | { type: "SET_CONTACT_NURTURE"; contactNurture: ReturnType<typeof readContactNurtureConfig> }
  | {
      type: "SET_LIMIT";
      key: keyof ReturnType<typeof readRunLimitFromTemplateConfig>;
      value: string;
    };

function initDialogState(template: Template): DialogState {
  const config = parseTemplateConfig(template.config);
  return {
    running: false,
    error: null,
    threadPath: null,
    workflowRunId: null,
    backlog: null,
    backlogLoading: false,
    pipelineBatchSize: PROFILE_PIPELINE_DEFAULT_BATCH,
    freshThread: false,
    systemPrompt: template.systemPrompt ?? "",
    patrol: readSocialPatrolConfig(config),
    profilePublish: readProfilePublishConfig(config),
    contactNurture: readContactNurtureConfig(config),
    limits: readRunLimitFromTemplateConfig(config),
  };
}

function dialogReducer(state: DialogState, action: DialogAction): DialogState {
  switch (action.type) {
    case "START_RUN":
      return { ...state, running: true, error: null, threadPath: null, workflowRunId: null };
    case "RUN_SUCCESS":
      return {
        ...state,
        running: false,
        error: null,
        workflowRunId: action.workflowRunId ?? null,
        threadPath: action.threadPath ?? null,
      };
    case "RUN_ERROR":
      return {
        ...state,
        running: false,
        error: action.error,
        threadPath: null,
        workflowRunId: null,
      };
    case "SET_BACKLOG_LOADING":
      return { ...state, backlogLoading: action.loading };
    case "SET_BACKLOG":
      return {
        ...state,
        backlog: action.backlog,
        backlogLoading: false,
        ...(action.batchSize !== undefined ? { pipelineBatchSize: action.batchSize } : {}),
      };
    case "SET_PIPELINE_BATCH_SIZE":
      return { ...state, pipelineBatchSize: action.batchSize };
    case "SET_FRESH_THREAD":
      return { ...state, freshThread: action.freshThread };
    case "SET_SYSTEM_PROMPT":
      return { ...state, systemPrompt: action.systemPrompt };
    case "SET_PATROL":
      return { ...state, patrol: action.patrol };
    case "SET_PROFILE_PUBLISH":
      return { ...state, profilePublish: action.profilePublish };
    case "SET_CONTACT_NURTURE":
      return { ...state, contactNurture: action.contactNurture };
    case "SET_LIMIT":
      return { ...state, limits: { ...state.limits, [action.key]: action.value } };
    default:
      return state;
  }
}

export function ActivateDialog({ template, open, onClose }: ActivateDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      {open && (
        <ActivateDialogContent
          key={template.id}
          template={template}
          onClose={onClose}
        />
      )}
    </Dialog>
  );
}

function ActivateDialogPipelineBacklog({
  backlog,
  backlogLoading,
  pipelineRunDisabled,
  pipelineBatchSize,
  pipelineBatchMax,
  onBatchSizeChange,
}: {
  backlog: PipelineBacklogPreview | null;
  backlogLoading: boolean;
  pipelineRunDisabled: boolean;
  pipelineBatchSize: number;
  pipelineBatchMax: number;
  onBatchSizeChange: (value: number) => void;
}) {
  return (
    <div className="rounded-lg bg-muted/50 p-3 text-sm">
      {backlogLoading ? (
        <span className="text-muted-foreground">Loading backlog…</span>
      ) : backlog ? (
        pipelineRunDisabled ? (
          <span>All contacts are up to date</span>
        ) : (
          <div className="space-y-3">
            <p>
              <strong>{backlog.backlogTotal}</strong> contacts need profile work ·
              weakest scores first
            </p>
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="pipeline-batch-size" className="text-xs">
                  Contacts this run
                </Label>
                <span className="text-xs font-medium tabular-nums">
                  {pipelineBatchSize}
                </span>
              </div>
              <input
                id="pipeline-batch-size"
                type="range"
                min={1}
                max={pipelineBatchMax}
                step={1}
                value={pipelineBatchSize}
                onChange={(e) => onBatchSizeChange(Number(e.target.value))}
                className="h-2 w-full cursor-pointer accent-primary"
              />
              <p className="text-xs text-muted-foreground">
                Up to {pipelineBatchMax} per run
              </p>
            </div>
          </div>
        )
      ) : (
        <span className="text-muted-foreground">Could not load backlog preview</span>
      )}
    </div>
  );
}

function ActivateDialogRunStatus({
  isPipeline,
  workflowRunId,
  threadPath,
}: {
  isPipeline: boolean;
  workflowRunId: string | null;
  threadPath: string | null;
}) {
  return (
    <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-100 space-y-2">
      {isPipeline ? (
        <p>Profile pipeline run started.</p>
      ) : (
        <p>Agent launched in RealTimeX.</p>
      )}
      {workflowRunId && (
        <Link
          href={`/dashboard/workflows/${workflowRunId}`}
          className="text-xs font-medium underline"
        >
          View run details
        </Link>
      )}
      {threadPath && <p className="font-mono text-xs">{threadPath}</p>}
    </div>
  );
}

function ActivateDialogFormFields({
  template,
  limits,
  patrol,
  profilePublish,
  contactNurture,
  systemPrompt,
  freshThread,
  running,
  isPatrol,
  isProfilePublish,
  isContactNurture,
  dispatch,
}: {
  template: Template;
  limits: DialogState["limits"];
  patrol: DialogState["patrol"];
  profilePublish: DialogState["profilePublish"];
  contactNurture: DialogState["contactNurture"];
  systemPrompt: string;
  freshThread: boolean;
  running: boolean;
  isPatrol: boolean;
  isProfilePublish: boolean;
  isContactNurture: boolean;
  dispatch: React.Dispatch<DialogAction>;
}) {
  return (
    <>
      {template.templateType === "prospecting" && (
        <div className="space-y-2">
          <Label htmlFor="max-results">Max Results</Label>
          <Input
            id="max-results"
            type="number"
            value={limits.maxResults}
            onChange={(e) =>
              dispatch({
                type: "SET_LIMIT",
                key: "maxResults",
                value: e.target.value,
              })
            }
          />
        </div>
      )}

      {template.templateType === "enrichment" && (
        <>
          <div className="space-y-2">
            <Label htmlFor="max-contacts">Max Contacts</Label>
            <Input
              id="max-contacts"
              type="number"
              value={limits.maxContacts}
              onChange={(e) =>
                dispatch({
                  type: "SET_LIMIT",
                  key: "maxContacts",
                  value: e.target.value,
                })
              }
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="max-score">Max Enrichment Score</Label>
            <Input
              id="max-score"
              type="number"
              value={limits.maxEnrichmentScore}
              onChange={(e) =>
                dispatch({
                  type: "SET_LIMIT",
                  key: "maxEnrichmentScore",
                  value: e.target.value,
                })
              }
            />
          </div>
        </>
      )}

      {template.templateType === "pruning" && (
        <>
          <div className="space-y-2">
            <Label htmlFor="company-name">Company Name</Label>
            <Input
              id="company-name"
              placeholder="e.g., Acme Corp"
              value={limits.companyName}
              onChange={(e) =>
                dispatch({
                  type: "SET_LIMIT",
                  key: "companyName",
                  value: e.target.value,
                })
              }
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="inactivity-days">Inactivity Days</Label>
            <Input
              id="inactivity-days"
              type="number"
              value={limits.inactivityDays}
              onChange={(e) =>
                dispatch({
                  type: "SET_LIMIT",
                  key: "inactivityDays",
                  value: e.target.value,
                })
              }
            />
          </div>
        </>
      )}

      {template.templateType === "content" && !isProfilePublish && (
        <>
          <div className="space-y-2">
            <Label htmlFor="topics">Topics / Industries</Label>
            <Input
              id="topics"
              placeholder="AI, fintech, developer tools"
              value={limits.topics}
              onChange={(e) =>
                dispatch({
                  type: "SET_LIMIT",
                  key: "topics",
                  value: e.target.value,
                })
              }
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="tone">Tone</Label>
            <Input
              id="tone"
              placeholder="professional"
              value={limits.tone}
              onChange={(e) =>
                dispatch({
                  type: "SET_LIMIT",
                  key: "tone",
                  value: e.target.value,
                })
              }
            />
          </div>
        </>
      )}

      {isPatrol && (
        <SocialPatrolFields
          value={patrol}
          onChange={(next) => dispatch({ type: "SET_PATROL", patrol: next })}
          disabled={running}
        />
      )}

      {isProfilePublish && (
        <ProfilePublishFields
          value={profilePublish}
          onChange={(next) =>
            dispatch({ type: "SET_PROFILE_PUBLISH", profilePublish: next })
          }
          disabled={running}
        />
      )}

      {isContactNurture && (
        <ContactNurtureFields
          value={contactNurture}
          onChange={(next) =>
            dispatch({ type: "SET_CONTACT_NURTURE", contactNurture: next })
          }
          disabled={running}
        />
      )}

      {!isPatrol &&
        !isContactNurture &&
        (template.templateType === "engagement" ||
          template.templateType === "outreach") && (
          <div className="space-y-2">
            <Label htmlFor="max-engagements">Max Engagements</Label>
            <Input
              id="max-engagements"
              type="number"
              value={limits.maxEngagements}
              onChange={(e) =>
                dispatch({
                  type: "SET_LIMIT",
                  key: "maxEngagements",
                  value: e.target.value,
                })
              }
            />
          </div>
        )}

      <Separator />

      <details className="space-y-2">
        <summary className="text-sm font-medium cursor-pointer">
          Instructions (Advanced)
        </summary>
        <div className="pt-2">
          <Textarea
            value={systemPrompt}
            onChange={(e) =>
              dispatch({
                type: "SET_SYSTEM_PROMPT",
                systemPrompt: e.target.value,
              })
            }
            rows={8}
            className="text-xs font-mono"
          />
        </div>
      </details>

      <div className="flex items-start justify-between gap-4 rounded-lg border p-3">
        <div className="space-y-0.5">
          <Label htmlFor="fresh-thread" className="text-sm font-medium">
            Start fresh thread for this run
          </Label>
          <p className="text-xs text-muted-foreground">
            Runs land in this template&apos;s dedicated RealTimeX thread so the agent
            keeps prior context. Turn this on for an isolated one-off session.
          </p>
        </div>
        <Switch
          id="fresh-thread"
          checked={freshThread}
          onCheckedChange={(checked) =>
            dispatch({ type: "SET_FRESH_THREAD", freshThread: checked })
          }
          disabled={running}
        />
      </div>
    </>
  );
}

function ActivateDialogContent({
  template,
  onClose,
}: {
  template: Template;
  onClose: () => void;
}) {
  const [state, dispatch] = useReducer(dialogReducer, template, initDialogState);
  const pipelineBatchSizeTouched = useRef(false);

  const templateConfig = parseTemplateConfig(template.config);
  const isPipeline = isPipelineTemplateConfig(template.config);
  const isPatrol = isSocialPatrolTemplateConfig(templateConfig);
  const isProfilePublish = isProfilePublishTemplateConfig(templateConfig);
  const isContactNurture = isContactNurtureTemplateConfig(templateConfig);

  const {
    running,
    error,
    threadPath,
    workflowRunId,
    backlog,
    backlogLoading,
    pipelineBatchSize,
    freshThread,
    systemPrompt,
    patrol,
    profilePublish,
    contactNurture,
    limits,
  } = state;

  useEffect(() => {
    if (!isPipeline) return;

    const controller = new AbortController();
    dispatch({ type: "SET_BACKLOG_LOADING", loading: true });
    fetch(`/api/workflows/templates/${template.id}/backlog`, {
      signal: controller.signal,
    })
      .then((r) => r.json())
      .then((data: PipelineBacklogPreview & { error?: string }) => {
        if (typeof data.backlogTotal === "number" && typeof data.batchSize === "number") {
          dispatch({
            type: "SET_BACKLOG",
            backlog: { backlogTotal: data.backlogTotal, batchSize: data.batchSize },
            batchSize: pipelineBatchSizeTouched.current
              ? undefined
              : clampPipelineBatchSize(data.batchSize, data.backlogTotal),
          });
        } else {
          dispatch({ type: "SET_BACKLOG_LOADING", loading: false });
        }
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        dispatch({ type: "SET_BACKLOG", backlog: null });
      });

    return () => controller.abort();
  }, [isPipeline, template.id]);

  async function handleRun() {
    dispatch({ type: "START_RUN" });

    try {
      const config: Record<string, unknown> = {};

      if (isPipeline) {
        const backlogTotal = backlog?.backlogTotal ?? PROFILE_PIPELINE_MAX_BATCH;
        config.batchSize = clampPipelineBatchSize(pipelineBatchSize, backlogTotal);
      } else if (isPatrol) {
        Object.assign(config, buildSocialPatrolRunConfig(patrol));
      } else if (isProfilePublish) {
        Object.assign(config, buildProfilePublishRunConfig(profilePublish));
      } else if (isContactNurture) {
        Object.assign(config, buildContactNurtureRunConfig(contactNurture));
      } else {
        if (template.templateType === "prospecting") {
          config.maxResults = parseInt(limits.maxResults, 10) || 20;
        }
        if (template.templateType === "enrichment") {
          config.maxContacts = parseInt(limits.maxContacts, 10) || 10;
          config.maxEnrichmentScore = parseInt(limits.maxEnrichmentScore, 10) || 50;
        }
        if (template.templateType === "pruning") {
          config.maxContacts = parseInt(limits.maxContacts, 10) || 20;
          config.companyName = limits.companyName || undefined;
          config.inactivityDays = parseInt(limits.inactivityDays, 10) || 365;
        }
        if (template.templateType === "content") {
          const topicsList = limits.topics.split(",").map((t) => t.trim()).filter(Boolean);
          if (topicsList.length > 0) config.topics = topicsList;
          if (limits.tone) config.tone = limits.tone;
        }
        if (template.templateType === "engagement" || template.templateType === "outreach") {
          const maxEng = parseInt(limits.maxEngagements, 10);
          if (maxEng > 0) {
            config.maxEngagements = maxEng;
            config.maxReplies = maxEng;
          }
        }
      }

      const res = await fetch(`/api/workflows/templates/${template.id}/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          config,
          systemPrompt: systemPrompt !== template.systemPrompt ? systemPrompt : undefined,
          freshThread: freshThread || undefined,
        }),
      });

      const raw = await res.text();
      let data: { error?: unknown; threadPath?: string; workflowRunId?: string } = {};
      try {
        data = raw ? (JSON.parse(raw) as typeof data) : {};
      } catch {
        dispatch({
          type: "RUN_ERROR",
          error: raw.trim() || "Failed to start agent",
        });
        return;
      }

      if (!res.ok) {
        dispatch({
          type: "RUN_ERROR",
          error: typeof data.error === "string" ? data.error : "Failed to start agent",
        });
        return;
      }

      dispatch({
        type: "RUN_SUCCESS",
        workflowRunId: data.workflowRunId,
        threadPath: data.threadPath,
      });
    } catch {
      dispatch({
        type: "RUN_ERROR",
        error: "Failed to start agent",
      });
    }
  }

  const runLaunched = Boolean(threadPath || workflowRunId);
  const pipelineRunDisabled =
    isPipeline &&
    (backlogLoading || backlog == null || backlog.backlogTotal === 0);
  // A patrol shift acts as a real profile — it cannot start without one.
  const patrolRunDisabled = isPatrol && !patrol.targetId;
  // Publishing needs at least one profile to publish to.
  const profilePublishRunDisabled =
    isProfilePublish && profilePublish.targetIds.length === 0;
  const pipelineBatchMax = backlog
    ? Math.min(PROFILE_PIPELINE_MAX_BATCH, Math.max(1, backlog.backlogTotal))
    : PROFILE_PIPELINE_MAX_BATCH;

  function handlePipelineBatchSizeChange(nextValue: number) {
    pipelineBatchSizeTouched.current = true;
    if (backlog) {
      dispatch({
        type: "SET_PIPELINE_BATCH_SIZE",
        batchSize: clampPipelineBatchSize(nextValue, backlog.backlogTotal),
      });
      return;
    }
    dispatch({
      type: "SET_PIPELINE_BATCH_SIZE",
      batchSize: Math.min(Math.max(1, Math.floor(nextValue)), PROFILE_PIPELINE_MAX_BATCH),
    });
  }

  return (
    <DialogContent
      showCloseButton={false}
      className="sm:max-w-2xl max-h-[85vh] p-0 flex flex-col overflow-hidden gap-0"
    >
      <div className="flex flex-col gap-1.5 p-6 pb-4 border-b shrink-0 bg-background">
        <div className="flex items-center justify-between gap-4">
          <DialogTitle className="text-lg font-semibold leading-none">
            {template.name}
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
        {template.description && (
          <DialogDescription className="text-sm text-muted-foreground">
            {template.description}
          </DialogDescription>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        {isPipeline && !runLaunched && (
          <ActivateDialogPipelineBacklog
            backlog={backlog}
            backlogLoading={backlogLoading}
            pipelineRunDisabled={pipelineRunDisabled}
            pipelineBatchSize={pipelineBatchSize}
            pipelineBatchMax={pipelineBatchMax}
            onBatchSizeChange={handlePipelineBatchSizeChange}
          />
        )}

        {template.targetPersona && !isPipeline && (
          <div className="rounded-lg bg-muted/50 p-3">
            <p className="text-xs font-medium text-muted-foreground mb-1">Audience / scope</p>
            <p className="text-sm">{template.targetPersona}</p>
          </div>
        )}

        {runLaunched && (
          <ActivateDialogRunStatus
            isPipeline={isPipeline}
            workflowRunId={workflowRunId}
            threadPath={threadPath}
          />
        )}

        {!runLaunched && !isPipeline && (
          <ActivateDialogFormFields
            template={template}
            limits={limits}
            patrol={patrol}
            profilePublish={profilePublish}
            contactNurture={contactNurture}
            systemPrompt={systemPrompt}
            freshThread={freshThread}
            running={running}
            isPatrol={isPatrol}
            isProfilePublish={isProfilePublish}
            isContactNurture={isContactNurture}
            dispatch={dispatch}
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
          <Button
            onClick={handleRun}
            disabled={
              running ||
              pipelineRunDisabled ||
              patrolRunDisabled ||
              profilePublishRunDisabled
            }
          >
            {running ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Play className="mr-2 h-4 w-4" />
            )}
            {running
              ? "Launching..."
              : pipelineRunDisabled
                ? "All contacts are up to date"
                : patrolRunDisabled || profilePublishRunDisabled
                  ? "Select an acting profile"
                  : isPipeline
                    ? "Run"
                    : isPatrol
                      ? "Start patrol shift"
                      : isProfilePublish
                        ? "Draft & publish"
                        : "Run Agent"}
          </Button>
        )}
      </div>
    </DialogContent>
  );
}
