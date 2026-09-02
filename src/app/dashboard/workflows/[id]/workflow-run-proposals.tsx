"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ExternalLink, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import type {
  ValidWorkflowRunProposal,
  WorkflowRunProposal,
  WorkflowRunProposalSummary,
  WorkflowRunProposals,
} from "@/lib/writing/workflow-run-proposals";

function surfaceLabel(surface: string): string {
  const [platform, kind] = surface.split("/");
  const platformLabel = platform === "x"
    ? "X"
    : `${platform.slice(0, 1).toUpperCase()}${platform.slice(1)}`;
  const kindLabel = kind === "direct_message"
    ? "DM"
    : kind === "comment"
      ? "comment"
      : kind;
  return `${platformLabel} ${kindLabel}`;
}

function capabilityLabel(capability: string): string {
  if (capability === "draft_only") return "Draft only";
  if (capability === "export_only") return "Export only";
  if (capability === "beta") return "Beta";
  if (capability === "direct") return "Direct";
  return "Unsupported";
}

function proposalStatus(proposal: ValidWorkflowRunProposal): string {
  if (proposal.materializedContentItemId) {
    return proposal.capability.publish === "draft_only" || proposal.capability.publish === "export_only"
      ? "Materialized · export only"
      : "Materialized";
  }
  if (proposal.variantStatus === "rejected" || proposal.approval.state === "rejected") {
    return "Rejected";
  }
  if (proposal.audit?.verdict === "block") return "Blocked by audit";
  if (proposal.revisionRequest) return "Revision requested";
  if (proposal.approval.state === "revoked") {
    return proposal.approval.revokedReason
      ? `Revoked · ${proposal.approval.revokedReason.replaceAll("_", " ")}`
      : "Revoked";
  }
  if (proposal.approval.state === "approved") return "Approved";
  return "Awaiting review";
}

function isPendingReview(proposal: ValidWorkflowRunProposal): boolean {
  return !proposal.materializedContentItemId
    && proposal.variantStatus !== "rejected"
    && proposal.approval.state !== "rejected"
    && proposal.audit?.verdict !== "block"
    && (proposal.approval.state === "pending" || proposal.approval.state === "revoked");
}

async function responseError(response: Response): Promise<string> {
  try {
    const body = await response.json() as {
      error?: string;
      details?: { reason?: string };
    };
    return body.details?.reason ?? body.error ?? "The proposal could not be updated";
  } catch {
    return "The proposal could not be updated";
  }
}

function ProposalCard({
  proposal,
  runId,
  onChanged,
}: {
  proposal: WorkflowRunProposal;
  runId: string;
  onChanged: () => Promise<void>;
}) {
  const [decision, setDecision] = useState<"reject" | "revision" | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!proposal.valid) {
    return (
      <Card
        className="space-y-3 border-destructive/40 p-4"
        data-testid="workflow-proposal-card"
        data-variant-id={proposal.variantId}
      >
        <div className="flex items-center justify-between gap-3">
          <p className="font-medium">Invalid writing proposal</p>
          <Badge variant="destructive">Blocked</Badge>
        </div>
        <pre className="whitespace-pre-wrap rounded-md bg-muted p-3 text-sm" data-testid="proposal-body">
          {proposal.body}
        </pre>
        <p className="text-xs text-destructive">{proposal.invalidReason}</p>
        <Button variant="outline" size="sm" asChild>
          <Link href={proposal.href}>Open variant</Link>
        </Button>
      </Card>
    );
  }

  const submit = async (action: "materialize" | "reject" | "request-revision") => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/variants/${proposal.variantId}/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          route: `/dashboard/workflows/${runId}`,
          ...(note.trim() ? { note: note.trim() } : {}),
        }),
      });
      if (!response.ok) {
        setError(await responseError(response));
        return;
      }
      setDecision(null);
      setNote("");
      await onChanged();
      if (action === "request-revision") {
        await fetch(`/api/workflows/runs/${runId}/open-thread`, { method: "POST" });
      }
    } catch {
      setError("Signals could not reach the proposal service");
    } finally {
      setBusy(false);
    }
  };

  const status = proposalStatus(proposal);
  const eligible = isPendingReview(proposal);
  return (
    <Card
      className="space-y-4 p-4"
      data-testid="workflow-proposal-card"
      data-variant-id={proposal.variantId}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          {proposal.recipient ? (
            <Link href={proposal.recipient.href} className="font-medium hover:underline">
              {proposal.recipient.name ?? proposal.recipient.handle ?? "Contact"}
              {proposal.recipient.handle ? ` · @${proposal.recipient.handle.replace(/^@/, "")}` : ""}
            </Link>
          ) : (
            <p className="font-medium">No recipient</p>
          )}
          {proposal.goal ? (
            <p className="text-xs text-muted-foreground">
              {proposal.goal.relationshipGoal.replaceAll("_", " ")}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge variant="outline">{surfaceLabel(proposal.surface)}</Badge>
          <Badge variant="secondary">{capabilityLabel(proposal.capability.publish)}</Badge>
          <Badge
            variant={status === "Rejected" || status === "Blocked by audit" ? "destructive" : "outline"}
            data-testid="proposal-status"
          >
            {status}
          </Badge>
        </div>
      </div>

      <pre
        className="max-h-80 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-3 font-sans text-sm"
        data-testid="proposal-body"
      >
        {proposal.body}
      </pre>

      <div className="space-y-2 text-xs">
        <p>
          Audit: <strong>{proposal.audit?.verdict ?? "not run"}</strong>
        </p>
        {proposal.audit?.findings.map((finding) => (
          <p key={`${finding.code}-${finding.message}`} className="text-muted-foreground">
            {finding.severity} · {finding.code} · {finding.message}
          </p>
        ))}
        {proposal.revisionRequest ? (
          <p className="rounded bg-muted px-2 py-1 text-muted-foreground">
            Revision note: {proposal.revisionRequest.note}
          </p>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" asChild>
          <Link href={proposal.href}>Open variant</Link>
        </Button>
        {proposal.materializedContentItemId ? (
          <Button variant="outline" size="sm" asChild>
            <Link href={`/dashboard/content/${proposal.materializedContentItemId}`}>
              Open content <ExternalLink className="ml-1 h-3 w-3" />
            </Link>
          </Button>
        ) : null}
        {eligible ? (
          <>
            <Button size="sm" disabled={busy} onClick={() => void submit("materialize")}>
              Approve &amp; materialize
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => setDecision(decision === "revision" ? null : "revision")}
            >
              Request revision
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => setDecision(decision === "reject" ? null : "reject")}
            >
              Reject
            </Button>
          </>
        ) : null}
      </div>

      {decision ? (
        <div className="space-y-2 rounded-md border p-3">
          <Textarea
            aria-label={decision === "revision" ? "Revision note" : "Rejection note"}
            placeholder={decision === "revision" ? "What should the agent change?" : "Optional reason"}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            maxLength={2_000}
          />
          <div className="flex gap-2">
            <Button
              size="sm"
              disabled={busy || (decision === "revision" && !note.trim())}
              onClick={() => void submit(decision === "revision" ? "request-revision" : "reject")}
            >
              {decision === "revision" ? "Send revision request" : "Confirm rejection"}
            </Button>
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => setDecision(null)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </Card>
  );
}

export function WorkflowRunProposalsPanel({
  runId,
  refreshKey,
  onSummaryChange,
}: {
  runId: string;
  refreshKey: string;
  onSummaryChange: (summary: WorkflowRunProposalSummary) => void;
}) {
  const [data, setData] = useState<WorkflowRunProposals | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const response = await fetch(`/api/workflows/${runId}/proposals`);
      if (!response.ok) {
        setError(await responseError(response));
        return;
      }
      const next = await response.json() as WorkflowRunProposals;
      setData(next);
      onSummaryChange(next.summary);
    } catch {
      setError("Signals could not load proposals");
    } finally {
      setLoading(false);
    }
  }, [onSummaryChange, runId]);

  useEffect(() => {
    void refresh();
  }, [refresh, refreshKey]);

  return (
    <section className="space-y-3" data-testid="workflow-run-proposals">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium">Proposals</h2>
          {data ? (
            <p className="text-xs text-muted-foreground">
              {data.summary.total} total · {data.summary.pendingReview} awaiting review ·{" "}
              {data.summary.materialized} materialized · {data.summary.rejected} rejected
            </p>
          ) : null}
        </div>
        <Button variant="outline" size="sm" disabled={loading} onClick={() => void refresh()}>
          <RefreshCw className="mr-1 h-3 w-3" /> Refresh
        </Button>
      </div>
      {loading && !data ? <p className="text-sm text-muted-foreground">Loading proposals…</p> : null}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {data?.proposals.length === 0 ? (
        <Card className="space-y-3 p-4">
          <p className="text-sm">No proposals were created. Open the thread for the agent&apos;s report.</p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void fetch(`/api/workflows/runs/${runId}/open-thread`, { method: "POST" })}
          >
            Open thread
          </Button>
        </Card>
      ) : null}
      {data?.proposals.map((proposal) => (
        <ProposalCard key={proposal.variantId} proposal={proposal} runId={runId} onChanged={refresh} />
      ))}
    </section>
  );
}
