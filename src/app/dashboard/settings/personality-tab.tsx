"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowUpRight,
  Bot,
  Check,
  ChevronRight,
  FileDiff,
  FileText,
  History,
  Loader2,
  RefreshCw,
  RotateCcw,
  Save,
  ShieldCheck,
  Sparkles,
  Unplug,
  UserRound,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { OPEN_PERSONALITY_ONBOARDING_EVENT, type PersonalityOnboardingState } from "@/lib/personality/onboarding-contract";
import type { PersonalityBindingView } from "@/lib/personality/status";
import type { PersonalityProposal, PersonalityProposalRecord } from "@/lib/personality/contracts";

type SourcesPayload = {
  self: {
    contactId: string;
    name: string;
    preferredName: string | null;
    headline: string | null;
    currentRole: { title: string; orgName: string } | null;
  };
  org: { orgId: string; name: string } | null;
  voice: {
    status: "active" | "ambiguous" | "none" | "unclaimed_only";
    candidates: Array<{
      id: string;
      version: number;
      hash: string;
      label: string;
    }>;
  };
};

type OrganizationPayload = {
  selected: { id: string; name: string } | null;
  candidates: Array<{ id: string; name: string }>;
};

type StatementsPayload = {
  values: string[];
  boundaries: string[];
};

type Representation =
  | { kind: "unbound" }
  | { kind: "self"; contactId: string }
  | { kind: "org"; orgId: string };

type TargetPayload = {
  id: string;
  platform: string;
  kind: string;
  name: string;
  handle: string | null;
  status: string;
  represents: Representation;
};

type PersonalityData = {
  binding: PersonalityBindingView;
  onboarding: PersonalityOnboardingState;
  sources: SourcesPayload | null;
  organizations: OrganizationPayload | null;
  statements: StatementsPayload;
  targets: TargetPayload[];
};

type ProposalView = {
  proposal: PersonalityProposal;
  record: PersonalityProposalRecord;
  actions: PersonalityBindingView["proposals"][number]["actions"];
};

const STATUS_PRESENTATION = {
  bound: { label: "In sync", variant: "success" as const },
  source_stale: { label: "Sources changed", variant: "warning" as const },
  drifted: { label: "Workspace drift", variant: "danger" as const },
  unbound: { label: "Not connected", variant: "neutral" as const },
  unavailable: { label: "Unavailable", variant: "danger" as const },
};

const PROPOSAL_PRESENTATION: Record<
  PersonalityProposalRecord["state"],
  { label: string; variant: "neutral" | "info" | "success" | "warning" | "danger" }
> = {
  proposed: { label: "Ready for review", variant: "info" },
  approved: { label: "Approved", variant: "info" },
  applying: { label: "Applying", variant: "warning" },
  applied: { label: "Applied", variant: "success" },
  apply_failed: { label: "Needs recovery", variant: "danger" },
  rejected: { label: "Rejected", variant: "neutral" },
  superseded: { label: "Superseded", variant: "neutral" },
  stale: { label: "Stale", variant: "danger" },
};

function formatTime(seconds: number): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(seconds * 1000));
}

function shortHash(value: string | null | undefined): string {
  return value ? `${value.slice(0, 8)}…${value.slice(-6)}` : "—";
}

function lines(value: string): string[] {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function responseError(body: unknown, fallback: string): string {
  if (body && typeof body === "object" && "error" in body) {
    const error = (body as { error?: unknown }).error;
    if (typeof error === "string") return error;
  }
  return fallback;
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(responseError(body, `Request failed (${response.status}).`));
  return body as T;
}

function statusDetail(binding: PersonalityBindingView): string {
  const { status } = binding;
  if (status.status === "bound") {
    return "Signals sources and the approved RealTimeX Personality revision match.";
  }
  if (status.status === "source_stale") {
    const changed = Object.entries(status.detail?.sourceStale ?? {})
      .filter(([, value]) => value)
      .map(([key]) => key);
    return `Signals changed since the last approval${changed.length ? `: ${changed.join(", ")}` : ""}. Create a new proposal to review the update.`;
  }
  if (status.status === "drifted") {
    return `${status.detail?.drifted?.length ?? 0} workspace file change(s) differ from the approved revision. Review before replacing anything.`;
  }
  if (status.status === "unbound") {
    return "No approved Signals projection is connected to this workspace yet.";
  }
  return status.detail?.unavailable ?? "The bound workspace or host is unavailable.";
}

function proposalTitle(proposal: PersonalityProposal): string {
  if (proposal.kind === "rollback") return "Rollback proposal";
  if (proposal.kind === "unbind") return "Disconnect proposal";
  return proposal.basedOnBindingId ? "Personality update" : "Initial Personality projection";
}

function representationValue(representation: Representation): string {
  if (representation.kind === "self") return "self";
  if (representation.kind === "org") return "org";
  return "unbound";
}

function ProposalCard({
  view,
  isLatest,
  hostAvailable,
  busy,
  onAction,
}: {
  view: ProposalView;
  isLatest: boolean;
  hostAvailable: boolean;
  busy: string | null;
  onAction: (kind: "approve" | "reject" | "retry", id: string) => void;
}) {
  const { proposal, record } = view;
  const presentation = PROPOSAL_PRESENTATION[record.state];
  const { canApprove, canReject, canRetry, approvalBlockers } = view.actions;
  const actionBusy = busy?.endsWith(proposal.id) ?? false;

  return (
    <Card className={isLatest ? "border-primary/30" : undefined}>
      <CardHeader className="gap-3 pb-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base">{proposalTitle(proposal)}</CardTitle>
            <p className="mt-1 font-mono text-xs text-muted-foreground">
              {proposal.id} · {formatTime(record.updatedAt)}
            </p>
          </div>
          <Badge variant={presentation.variant}>{presentation.label}</Badge>
        </div>
        {proposal.preflight.warnings.length > 0 && (
          <div className="rounded-md border border-warning/30 bg-warning/10 p-2 text-xs text-warning">
            {proposal.preflight.warnings.join(" · ")}
          </div>
        )}
        {proposal.noop && (
          <p className="text-sm text-muted-foreground">
            No bytes would change, so this proposal cannot be approved.
          </p>
        )}
        {approvalBlockers.length > 0 && record.state === "proposed" && (
          <div className="rounded-md border border-danger/30 bg-danger/10 p-2 text-sm text-danger">
            Approval is blocked by current server state: {approvalBlockers.map((reason) => reason.replaceAll("_", " ")).join(", ")}.
          </div>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-2">
          {proposal.files.map((file) => (
            <details key={file.path} className="group rounded-lg border bg-muted/10">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2.5 text-sm font-medium">
                <span className="flex items-center gap-2">
                  <ChevronRight className="h-4 w-4 transition-transform group-open:rotate-90" />
                  {file.path}
                </span>
                <span className="text-xs font-normal text-muted-foreground">
                  {file.diff ? "changes" : "unchanged"} · {file.unmanagedBytes} unmanaged bytes
                </span>
              </summary>
              <div className="space-y-3 border-t p-3">
                {file.driftDiff && (
                  <div>
                    <p className="mb-1 text-xs font-semibold text-warning">
                      Existing drift from the approved revision
                    </p>
                    <pre className="max-h-56 overflow-auto rounded-md bg-slate-950 p-3 text-xs leading-5 text-slate-100">
                      {file.driftDiff}
                    </pre>
                  </div>
                )}
                <div>
                  <p className="mb-1 text-xs font-semibold">Exact whole-file diff</p>
                  <pre className="max-h-72 overflow-auto rounded-md bg-slate-950 p-3 text-xs leading-5 text-slate-100">
                    {file.diff || "No byte changes."}
                  </pre>
                </div>
                <details>
                  <summary className="cursor-pointer text-xs font-medium text-primary">
                    Inspect exact final bytes
                  </summary>
                  <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap rounded-md border bg-background p-3 text-xs leading-5">
                    {file.proposedFile ?? "(File will not exist after apply.)"}
                  </pre>
                </details>
              </div>
            </details>
          ))}
        </div>

        {record.failure && (
          <div className="rounded-lg border border-danger/30 bg-danger/10 p-3 text-sm text-danger">
            <strong>{record.failure.step}:</strong> {record.failure.reason}
            {record.failure.hostRecovery && (
              <span className="mt-1 block text-xs">
                Host transaction {record.failure.hostRecovery.transactionId} · {record.failure.hostRecovery.status}
              </span>
            )}
          </div>
        )}
        {record.hostResult && (
          <p className="text-xs text-muted-foreground">
            Host transaction: {record.hostResult.status}
            {record.hostResult.replayed ? " · replayed safely" : ""}
          </p>
        )}

        {(canApprove || canReject || canRetry || record.state === "proposed") && (
          <div className="flex flex-wrap justify-end gap-2 border-t pt-3">
            {canReject && (
              <Button
                variant="outline"
                size="sm"
                disabled={actionBusy}
                onClick={() => onAction("reject", proposal.id)}
              >
                <X /> Reject
              </Button>
            )}
            {canRetry && (
              <Button
                variant="outline"
                size="sm"
                disabled={actionBusy || !hostAvailable}
                onClick={() => onAction("retry", proposal.id)}
              >
                <RefreshCw /> Retry recovery
              </Button>
            )}
            <Button
              size="sm"
              disabled={!canApprove || actionBusy}
              title={!hostAvailable ? "RealTimeX Personality transactions are unavailable" : undefined}
              onClick={() => onAction("approve", proposal.id)}
            >
              {actionBusy ? <Loader2 className="animate-spin" /> : <Check />}
              Approve &amp; apply
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function PersonalityTab() {
  const [data, setData] = useState<PersonalityData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [valuesText, setValuesText] = useState("");
  const [boundariesText, setBoundariesText] = useState("");

  const refresh = useCallback(async (quiet = false) => {
    if (!quiet) setRefreshing(true);
    setError(null);
    try {
      const [binding, onboarding, statements, targetsResult] = await Promise.all([
        requestJson<PersonalityBindingView>("/api/personality/binding"),
        requestJson<PersonalityOnboardingState>("/api/personality/onboarding"),
        requestJson<StatementsPayload>("/api/personality/statements"),
        requestJson<{ targets: TargetPayload[] }>("/api/platform-targets"),
      ]);
      const [sources, organizations] = await Promise.all([
        requestJson<SourcesPayload>("/api/personality/sources").catch(() => null),
        requestJson<OrganizationPayload>("/api/personality/represented-org").catch(
          () => null,
        ),
      ]);
      setData({
        binding,
        onboarding,
        sources,
        organizations,
        statements,
        targets: targetsResult.targets.filter((target) => target.status === "active"),
      });
      setValuesText(statements.values.join("\n"));
      setBoundariesText(statements.boundaries.join("\n"));
    } catch (refreshError) {
      setError(
        refreshError instanceof Error
          ? refreshError.message
          : "Could not load Personality settings.",
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    refresh(true);
  }, [refresh]);

  const currentBindingId = data?.binding.status.binding?.id ?? null;
  const hostAvailable = data?.binding.status.host.capability === "available";
  const proposals = (data?.binding.proposals ?? []) as ProposalView[];
  const statusPresentation = data
    ? STATUS_PRESENTATION[data.binding.status.status]
    : STATUS_PRESENTATION.unavailable;

  const sourceLabels = useMemo(() => {
    const sources = data?.binding.status.detail?.sourceStale;
    if (!sources) return [];
    return Object.entries(sources)
      .filter(([, changed]) => changed)
      .map(([source]) => source);
  }, [data]);

  async function runAction(key: string, operation: () => Promise<unknown>, message: string) {
    setBusy(key);
    setError(null);
    setSuccess(null);
    try {
      await operation();
      setSuccess(message);
      await refresh(true);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Action failed.");
    } finally {
      setBusy(null);
    }
  }

  function post(url: string, body?: unknown) {
    return requestJson(url, {
      method: "POST",
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  function handleProposalAction(kind: "approve" | "reject" | "retry", id: string) {
    const suffix = kind === "approve" ? "approve" : kind === "reject" ? "reject" : "retry";
    const message =
      kind === "approve"
        ? "Personality proposal applied."
        : kind === "reject"
          ? "Personality proposal rejected."
          : "Personality recovery retried.";
    runAction(`${kind}:${id}`, () => post(`/api/personality/proposals/${id}/${suffix}`, kind === "reject" ? {} : undefined), message);
  }

  if (loading) {
    return (
      <div className="flex min-h-72 items-center justify-center text-sm text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading Personality…
      </div>
    );
  }

  if (!data) {
    return (
      <Card>
        <CardContent className="flex min-h-56 flex-col items-center justify-center gap-3 text-center">
          <AlertTriangle className="h-8 w-8 text-danger" />
          <p className="font-medium">Personality settings are unavailable</p>
          <p className="max-w-lg text-sm text-muted-foreground">{error}</p>
          <Button variant="outline" onClick={() => refresh()}>
            <RefreshCw /> Try again
          </Button>
        </CardContent>
      </Card>
    );
  }

  const { binding, onboarding, sources, organizations, statements, targets } = data;
  const active = binding.status.binding;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-heading-2">Personality</h2>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Connect Signals&apos; verified identity and voice sources to the
            Personality used by agents in your bound RealTimeX workspace.
          </p>
        </div>
        <Button variant="outline" disabled={refreshing} onClick={() => refresh()}>
          <RefreshCw className={refreshing ? "animate-spin" : undefined} /> Refresh
        </Button>
      </div>

      {success && (
        <div className="rounded-lg border border-success/30 bg-success/10 p-3 text-sm text-success">
          {success}
        </div>
      )}
      {error && (
        <div role="alert" className="rounded-lg border border-danger/30 bg-danger/10 p-3 text-sm text-danger">
          {error}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Bot className="h-4 w-4 text-primary" /> Bound RealTimeX workspace
              </CardTitle>
              <Badge variant={onboarding.editor.state === "available" ? "success" : "danger"}>
                Editor {onboarding.editor.state.replace("_", " ")}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div>
              <p className="font-semibold">{onboarding.workspace.displayName}</p>
              <p className="text-muted-foreground">
                {onboarding.workspace.slug} · workspace {onboarding.workspace.id ?? "unknown"}
              </p>
            </div>
            <code className="block break-all rounded-md border bg-muted/30 p-2 text-xs">
              {onboarding.workspace.path}
            </code>
            <p className="text-xs text-muted-foreground">
              Host-derived and read only. This screen never offers another workspace selector.
            </p>
            <Button
              variant="outline"
              disabled={onboarding.editor.state !== "available"}
              onClick={() => window.dispatchEvent(new Event(OPEN_PERSONALITY_ONBOARDING_EVENT))}
            >
              <Sparkles /> Open AI Editor handoff <ArrowUpRight />
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <UserRound className="h-4 w-4 text-primary" /> Represented identity
              </CardTitle>
              <Badge variant={sources ? "info" : "warning"}>
                {sources ? "Signals source" : "Self contact needed"}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            {sources ? (
              <div>
                <p className="font-semibold">{sources.self.preferredName || sources.self.name}</p>
                <p className="text-muted-foreground">
                  {sources.self.headline ||
                    (sources.self.currentRole
                      ? `${sources.self.currentRole.title} at ${sources.self.currentRole.orgName}`
                      : "Self contact")}
                </p>
              </div>
            ) : (
              <p className="text-muted-foreground">
                Mark a contact as self before creating an approved Signals projection.
              </p>
            )}
            {organizations && (
              <div className="space-y-2">
                <Label htmlFor="represented-org">Organization these agents represent</Label>
                <Select
                  value={organizations.selected?.id ?? "self"}
                  disabled={busy === "represented-org"}
                  onValueChange={(value) =>
                    runAction(
                      "represented-org",
                      () =>
                        requestJson("/api/personality/represented-org", {
                          method: "PUT",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ orgId: value === "self" ? null : value }),
                        }),
                      "Represented identity updated. Create a new proposal to review it.",
                    )
                  }
                >
                  <SelectTrigger id="represented-org" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="self">Self only</SelectItem>
                    {organizations.candidates.map((organization) => (
                      <SelectItem key={organization.id} value={organization.id}>
                        {organization.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Only organizations owned by your self contact are eligible.
                </p>
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              Voice: {sources?.voice.candidates[0]?.label ?? "No approved self-owned voice profile"}
              {sources?.voice.status === "ambiguous" ? " · multiple profiles need review" : ""}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <ShieldCheck className="h-4 w-4 text-primary" /> Active projection
              </CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">{statusDetail(binding)}</p>
            </div>
            <Badge variant={statusPresentation.variant}>{statusPresentation.label}</Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {active ? (
            <div className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <p className="text-xs text-muted-foreground">Binding</p>
                <p className="font-mono">{active.id}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Approved</p>
                <p>{formatTime(active.appliedAt)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Personality hash</p>
                <p className="font-mono">{shortHash(active.personalityHash)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Compatible targets</p>
                <p>{binding.status.compatibleTargets.length}</p>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Review and approve an initial proposal to create the active connection.
            </p>
          )}

          {binding.status.detail?.drifted && (
            <div className="flex flex-wrap gap-2">
              {binding.status.detail.drifted.map((entry) => (
                <Badge key={`${entry.path}:${entry.reason}`} variant="danger">
                  {entry.path}: {entry.reason.replaceAll("_", " ")}
                </Badge>
              ))}
            </div>
          )}
          {sourceLabels.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {sourceLabels.map((source) => (
                <Badge key={source} variant="warning">
                  {source} changed
                </Badge>
              ))}
            </div>
          )}
          <Separator />
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={!sources || binding.status.status === "unavailable" || busy !== null}
              onClick={() =>
                runAction(
                  "create-proposal",
                  () => post("/api/personality/proposals", {}),
                  "A new immutable proposal is ready for review.",
                )
              }
            >
              {busy === "create-proposal" ? <Loader2 className="animate-spin" /> : <FileDiff />}
              {active ? "Create update proposal" : "Create initial proposal"}
            </Button>
            {active && (
              <Button
                variant="outline"
                disabled={busy !== null}
                onClick={() =>
                  runAction(
                    "unbind",
                    () => post("/api/personality/unbind"),
                    "A disconnect proposal is ready for review.",
                  )
                }
              >
                <Unplug /> Propose disconnect
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Explicit values &amp; boundaries</CardTitle>
          <p className="text-sm text-muted-foreground">
            One concise statement per line. These user-authored instructions take precedence over inferred voice patterns.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="personality-values">Values</Label>
              <Textarea
                id="personality-values"
                value={valuesText}
                onChange={(event) => setValuesText(event.target.value)}
                placeholder="Be useful before being impressive"
                className="min-h-28"
              />
              <p className="text-xs text-muted-foreground">{lines(valuesText).length}/12 statements</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="personality-boundaries">Boundaries</Label>
              <Textarea
                id="personality-boundaries"
                value={boundariesText}
                onChange={(event) => setBoundariesText(event.target.value)}
                placeholder="Never invent customer outcomes"
                className="min-h-28"
              />
              <p className="text-xs text-muted-foreground">{lines(boundariesText).length}/12 statements</p>
            </div>
          </div>
          <div className="flex justify-end">
            <Button
              variant="outline"
              disabled={
                busy !== null ||
                lines(valuesText).length > 12 ||
                lines(boundariesText).length > 12 ||
                (valuesText === statements.values.join("\n") &&
                  boundariesText === statements.boundaries.join("\n"))
              }
              onClick={() =>
                runAction(
                  "save-statements",
                  () =>
                    requestJson("/api/personality/statements", {
                      method: "PUT",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        values: lines(valuesText),
                        boundaries: lines(boundariesText),
                      }),
                    }),
                  "Values and boundaries saved. Create a proposal to project them.",
                )
              }
            >
              {busy === "save-statements" ? <Loader2 className="animate-spin" /> : <Save />}
              Save statements
            </Button>
          </div>
        </CardContent>
      </Card>

      <section className="space-y-3" aria-labelledby="personality-proposals-heading">
        <div>
          <h3 id="personality-proposals-heading" className="text-heading-3">
            Proposal review
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Approval always applies the exact persisted whole-file bytes shown below.
          </p>
        </div>
        {proposals.length === 0 ? (
          <Card>
            <CardContent className="flex min-h-32 items-center justify-center text-sm text-muted-foreground">
              No Personality proposals yet.
            </CardContent>
          </Card>
        ) : (
          proposals.map((view, index) => (
            <ProposalCard
              key={view.proposal.id}
              view={view}
              isLatest={index === 0}
              hostAvailable={hostAvailable}
              busy={busy}
              onAction={handleProposalAction}
            />
          ))
        )}
      </section>

      {binding.history.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <History className="h-4 w-4 text-primary" /> Approved history
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {binding.history.map((historical) => (
              <div key={historical.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3 text-sm">
                <div>
                  <p className="font-mono">{historical.id}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatTime(historical.appliedAt)} · {shortHash(historical.personalityHash)}
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy !== null}
                  onClick={() =>
                    runAction(
                      `rollback:${historical.id}`,
                      () => post("/api/personality/rollback", { bindingId: historical.id }),
                      "A rollback proposal is ready for review.",
                    )
                  }
                >
                  <RotateCcw /> Propose rollback
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Platform representation</CardTitle>
          <p className="text-sm text-muted-foreground">
            Explicitly choose whether each active social target represents you, your selected organization, or neither.
          </p>
        </CardHeader>
        <CardContent className="space-y-2">
          {!active ? (
            <p className="text-sm text-muted-foreground">
              Approve a Personality projection before connecting platform targets.
            </p>
          ) : targets.length === 0 ? (
            <p className="text-sm text-muted-foreground">No active platform targets.</p>
          ) : (
            targets.map((target) => (
              <div key={target.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3">
                <div>
                  <p className="text-sm font-medium">{target.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {target.platform} · {target.kind}{target.handle ? ` · ${target.handle}` : ""}
                  </p>
                </div>
                <Select
                  value={representationValue(target.represents)}
                  disabled={busy === `target:${target.id}`}
                  onValueChange={(value) => {
                    const represents: Representation =
                      value === "self"
                        ? { kind: "self", contactId: active.identity.selfContactId }
                        : value === "org" && active.identity.representedOrgId
                          ? { kind: "org", orgId: active.identity.representedOrgId }
                          : { kind: "unbound" };
                    runAction(
                      `target:${target.id}`,
                      () =>
                        requestJson(`/api/platform-targets/${target.id}/representation`, {
                          method: "PUT",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ bindingId: active.id, represents }),
                        }),
                      `${target.name} representation updated.`,
                    );
                  }}
                >
                  <SelectTrigger className="w-48">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="unbound">Not represented</SelectItem>
                    <SelectItem value="self">Represents me</SelectItem>
                    {active.identity.representedOrgId && (
                      <SelectItem value="org">
                        Represents {organizations?.selected?.name ?? "my organization"}
                      </SelectItem>
                    )}
                  </SelectContent>
                </Select>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      {binding.diagnostics.orphanProposalIds.length > 0 && (
        <div className="rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm text-warning">
          <AlertTriangle className="mr-2 inline h-4 w-4" />
          Store diagnostics found {binding.diagnostics.orphanProposalIds.length} orphan proposal file(s). No automatic repair was attempted.
        </div>
      )}
    </div>
  );
}
