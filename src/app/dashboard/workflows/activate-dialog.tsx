"use client";

import { useState, useEffect, useRef } from "react";
import {
  Dialog,
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
import { Loader2, Play } from "lucide-react";
import Link from "next/link";
import {
  PROFILE_PIPELINE_DEFAULT_BATCH,
  PROFILE_PIPELINE_MAX_BATCH,
  clampPipelineBatchSize,
  readRunLimitFromTemplateConfig,
} from "@/app/dashboard/workflows/activate-dialog.utils";
import { SocialPatrolFields } from "@/app/dashboard/workflows/social-patrol-fields";
import { ProfilePublishFields } from "@/app/dashboard/workflows/profile-publish-fields";
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

export function ActivateDialog({ template, open, onClose }: ActivateDialogProps) {
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [threadPath, setThreadPath] = useState<string | null>(null);
  const [workflowRunId, setWorkflowRunId] = useState<string | null>(null);
  const [backlog, setBacklog] = useState<PipelineBacklogPreview | null>(null);
  const [backlogLoading, setBacklogLoading] = useState(false);
  const [freshThread, setFreshThread] = useState(false);
  const [pipelineBatchSize, setPipelineBatchSize] = useState(
    PROFILE_PIPELINE_DEFAULT_BATCH,
  );
  const pipelineBatchSizeTouched = useRef(false);

  const [systemPrompt, setSystemPrompt] = useState(template.systemPrompt ?? "");
  const templateConfig = parseTemplateConfig(template.config);
  const isPipeline = isPipelineTemplateConfig(template.config);
  const isPatrol = isSocialPatrolTemplateConfig(templateConfig);
  const isProfilePublish = isProfilePublishTemplateConfig(templateConfig);

  const [patrol, setPatrol] = useState(() => readSocialPatrolConfig(templateConfig));
  const [profilePublish, setProfilePublish] = useState(() =>
    readProfilePublishConfig(templateConfig),
  );

  const initialLimits = readRunLimitFromTemplateConfig(templateConfig);
  const [maxResults, setMaxResults] = useState(initialLimits.maxResults);
  const [maxContacts, setMaxContacts] = useState(initialLimits.maxContacts);
  const [maxEnrichmentScore, setMaxEnrichmentScore] = useState(initialLimits.maxEnrichmentScore);
  const [companyName, setCompanyName] = useState(initialLimits.companyName);
  const [inactivityDays, setInactivityDays] = useState(initialLimits.inactivityDays);
  const [topics, setTopics] = useState(initialLimits.topics);
  const [tone, setTone] = useState(initialLimits.tone);
  const [maxEngagements, setMaxEngagements] = useState(initialLimits.maxEngagements);

  useEffect(() => {
    if (!open) return;

    const config = parseTemplateConfig(template.config);
    const limits = readRunLimitFromTemplateConfig(config);
    setPatrol(readSocialPatrolConfig(config));
    setProfilePublish(readProfilePublishConfig(config));
    setMaxResults(limits.maxResults);
    setMaxContacts(limits.maxContacts);
    setMaxEnrichmentScore(limits.maxEnrichmentScore);
    setCompanyName(limits.companyName);
    setInactivityDays(limits.inactivityDays);
    setTopics(limits.topics);
    setTone(limits.tone);
    setMaxEngagements(limits.maxEngagements);
    setSystemPrompt(template.systemPrompt ?? "");
    setFreshThread(false);
  }, [open, template.id, template.config, template.systemPrompt, template.templateType]);

  useEffect(() => {
    if (!open || !isPipeline) {
      setBacklog(null);
      setPipelineBatchSize(PROFILE_PIPELINE_DEFAULT_BATCH);
      pipelineBatchSizeTouched.current = false;
      return;
    }

    const controller = new AbortController();
    setBacklogLoading(true);
    fetch(`/api/workflows/templates/${template.id}/backlog`, {
      signal: controller.signal,
    })
      .then((r) => r.json())
      .then((data: PipelineBacklogPreview & { error?: string }) => {
        if (typeof data.backlogTotal === "number" && typeof data.batchSize === "number") {
          if (!pipelineBatchSizeTouched.current) {
            setPipelineBatchSize(
              clampPipelineBatchSize(data.batchSize, data.backlogTotal),
            );
          }
          setBacklog({ backlogTotal: data.backlogTotal, batchSize: data.batchSize });
        }
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setBacklog(null);
      })
      .finally(() => setBacklogLoading(false));

    return () => controller.abort();
  }, [open, isPipeline, template.id]);

  async function handleRun() {
    setRunning(true);
    setError(null);
    setThreadPath(null);
    setWorkflowRunId(null);

    try {
      const config: Record<string, unknown> = {};

      if (isPipeline) {
        const backlogTotal = backlog?.backlogTotal ?? PROFILE_PIPELINE_MAX_BATCH;
        config.batchSize = clampPipelineBatchSize(pipelineBatchSize, backlogTotal);
      } else if (isPatrol) {
        Object.assign(config, buildSocialPatrolRunConfig(patrol));
      } else if (isProfilePublish) {
        Object.assign(config, buildProfilePublishRunConfig(profilePublish));
      } else {
        if (template.templateType === "prospecting") {
          config.maxResults = parseInt(maxResults, 10) || 20;
        }
        if (template.templateType === "enrichment") {
          config.maxContacts = parseInt(maxContacts, 10) || 10;
          config.maxEnrichmentScore = parseInt(maxEnrichmentScore, 10) || 50;
        }
        if (template.templateType === "pruning") {
          config.maxContacts = parseInt(maxContacts, 10) || 20;
          config.companyName = companyName || undefined;
          config.inactivityDays = parseInt(inactivityDays, 10) || 365;
        }
        if (template.templateType === "content") {
          const topicsList = topics.split(",").map((t) => t.trim()).filter(Boolean);
          if (topicsList.length > 0) config.topics = topicsList;
          if (tone) config.tone = tone;
        }
        if (template.templateType === "engagement" || template.templateType === "outreach") {
          const maxEng = parseInt(maxEngagements, 10);
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
        setError(raw.trim() || "Failed to start agent");
        return;
      }

      if (!res.ok) {
        setError(
          typeof data.error === "string" ? data.error : "Failed to start agent",
        );
        return;
      }

      if (data.workflowRunId) {
        setWorkflowRunId(data.workflowRunId);
      }
      if (data.threadPath) {
        setThreadPath(data.threadPath);
      }
    } catch {
      setError("Failed to start agent");
    } finally {
      setRunning(false);
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
      setPipelineBatchSize(clampPipelineBatchSize(nextValue, backlog.backlogTotal));
      return;
    }
    setPipelineBatchSize(
      Math.min(Math.max(1, Math.floor(nextValue)), PROFILE_PIPELINE_MAX_BATCH),
    );
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{template.name}</DialogTitle>
          <DialogDescription>{template.description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          {isPipeline && !runLaunched && (
            <div className="rounded-lg bg-muted/50 p-3 text-sm">
              {backlogLoading ? (
                <span className="text-muted-foreground">Loading backlog…</span>
              ) : backlog ? (
                pipelineRunDisabled ? (
                  <span>All contacts are up to date</span>
                ) : (
                  <div className="space-y-3">
                    <p>
                      <strong>{backlog.backlogTotal}</strong> contacts need profile work
                      · weakest scores first
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
                        onChange={(e) =>
                          handlePipelineBatchSizeChange(Number(e.target.value))
                        }
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
          )}

          {template.targetPersona && !isPipeline && (
            <div className="rounded-lg bg-muted/50 p-3">
              <p className="text-xs font-medium text-muted-foreground mb-1">Audience / scope</p>
              <p className="text-sm">{template.targetPersona}</p>
            </div>
          )}

          {runLaunched && (
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
              {threadPath && (
                <p className="font-mono text-xs">{threadPath}</p>
              )}
            </div>
          )}

          {!runLaunched && !isPipeline && (
            <>
              {template.templateType === "prospecting" && (
                <div className="space-y-2">
                  <Label htmlFor="max-results">Max Results</Label>
                  <Input
                    id="max-results"
                    type="number"
                    value={maxResults}
                    onChange={(e) => setMaxResults(e.target.value)}
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
                      value={maxContacts}
                      onChange={(e) => setMaxContacts(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="max-score">Max Enrichment Score</Label>
                    <Input
                      id="max-score"
                      type="number"
                      value={maxEnrichmentScore}
                      onChange={(e) => setMaxEnrichmentScore(e.target.value)}
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
                      value={companyName}
                      onChange={(e) => setCompanyName(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="inactivity-days">Inactivity Days</Label>
                    <Input
                      id="inactivity-days"
                      type="number"
                      value={inactivityDays}
                      onChange={(e) => setInactivityDays(e.target.value)}
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
                      value={topics}
                      onChange={(e) => setTopics(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="tone">Tone</Label>
                    <Input
                      id="tone"
                      placeholder="professional"
                      value={tone}
                      onChange={(e) => setTone(e.target.value)}
                    />
                  </div>
                </>
              )}

              {isPatrol && (
                <SocialPatrolFields
                  value={patrol}
                  onChange={setPatrol}
                  disabled={running}
                />
              )}

              {isProfilePublish && (
                <ProfilePublishFields
                  value={profilePublish}
                  onChange={setProfilePublish}
                  disabled={running}
                />
              )}

              {!isPatrol &&
                (template.templateType === "engagement" ||
                  template.templateType === "outreach") && (
                  <div className="space-y-2">
                    <Label htmlFor="max-engagements">Max Engagements</Label>
                    <Input
                      id="max-engagements"
                      type="number"
                      value={maxEngagements}
                      onChange={(e) => setMaxEngagements(e.target.value)}
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
                    onChange={(e) => setSystemPrompt(e.target.value)}
                    rows={8}
                    className="text-xs font-mono"
                  />
                </div>
              </details>
            </>
          )}

          {!runLaunched && (
            <div className="flex items-start justify-between gap-4 rounded-lg border p-3">
              <div className="space-y-0.5">
                <Label htmlFor="fresh-thread" className="text-sm font-medium">
                  Start fresh thread for this run
                </Label>
                <p className="text-xs text-muted-foreground">
                  Runs land in this template&apos;s dedicated RealTimeX thread so the
                  agent keeps prior context. Turn this on for an isolated one-off
                  session.
                </p>
              </div>
              <Switch
                id="fresh-thread"
                checked={freshThread}
                onCheckedChange={setFreshThread}
                disabled={running}
              />
            </div>
          )}

          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
              {error}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
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
        </div>
      </DialogContent>
    </Dialog>
  );
}
