"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  BriefcaseBusiness,
  Building2,
  ExternalLink,
  GitBranch,
  RotateCcw,
  ShieldAlert,
  UserCheck,
} from "lucide-react";
import { WorkflowRunAgentThreadButton } from "@/app/dashboard/workflows/[id]/workflow-run-agent-thread-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatCandidateTimestamp } from "./quarantine-utils";
import type { QuarantineCandidateItem } from "./types";

function formatReason(reason: string): string {
  return reason.replaceAll("_", " ");
}

function CandidateStatusBadge({ status }: { status: QuarantineCandidateItem["status"] }) {
  if (status === "promoted") return <Badge variant="success">Promoted</Badge>;
  if (status === "dismissed") return <Badge variant="neutral">Dismissed</Badge>;
  return <Badge variant="warning">Needs verification</Badge>;
}

type ReviewAction = "dismiss" | "reopen";

async function requestCandidateStatusUpdate(id: string, action: ReviewAction): Promise<void> {
  const response = await fetch(`/api/snowball-candidates/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action }),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error || "Could not update candidate");
  }
}

function CandidateDialogHeader({ candidate }: { candidate: QuarantineCandidateItem }) {
  const description = [candidate.proposedTitle, candidate.proposedCompany]
    .filter(Boolean)
    .join(" · ") || "LinkedIn identity candidate";
  return (
    <DialogHeader className="pr-8">
      <div className="flex flex-wrap items-center gap-2">
        <DialogTitle>{candidate.proposedName}</DialogTitle>
        <CandidateStatusBadge status={candidate.status} />
      </div>
      <DialogDescription>{description}</DialogDescription>
    </DialogHeader>
  );
}

function CandidateIdentityContext({ candidate }: { candidate: QuarantineCandidateItem }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <section className="min-w-0 rounded-lg border p-4 sm:col-span-2">
        <div className="mb-2 flex items-center gap-2 text-sm font-medium">
          <ShieldAlert className="size-4 text-warning" /> Identity gate
        </div>
        <p className="break-words text-sm">{candidate.failureMessage}</p>
        <p className="mt-2 text-xs capitalize text-muted-foreground">
          {formatReason(candidate.failureReason)} · {candidate.attemptCount}{" "}
          {candidate.attemptCount === 1 ? "attempt" : "attempts"}
        </p>
      </section>

      <section className="min-w-0 space-y-3 rounded-lg border p-4">
        <h3 className="text-sm font-medium">Proposed identity</h3>
        {candidate.proposedTitle ? (
          <p className="flex gap-2 text-sm">
            <BriefcaseBusiness className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            {candidate.proposedTitle}
          </p>
        ) : null}
        {candidate.proposedCompany ? (
          <p className="flex gap-2 text-sm">
            <Building2 className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            {candidate.proposedCompany}
          </p>
        ) : null}
        <a
          href={candidate.profileUrl}
          target="_blank"
          rel="noreferrer"
          className="flex min-w-0 overflow-hidden gap-2 text-sm text-primary hover:underline"
        >
          <ExternalLink className="mt-0.5 size-4 shrink-0" />
          <span className="truncate">{candidate.profileUrl}</span>
        </a>
      </section>

      <section className="min-w-0 space-y-3 rounded-lg border p-4">
        <h3 className="text-sm font-medium">Discovery source</h3>
        {candidate.seedValue ? (
          <p className="break-words text-sm text-muted-foreground">{candidate.seedValue}</p>
        ) : (
          <p className="text-sm text-muted-foreground">No seed recorded</p>
        )}
        <Button variant="outline" size="sm" asChild>
          <Link href={`/dashboard/workflows/${candidate.workflowRunId}`}>
            <GitBranch /> View source run
          </Link>
        </Button>
      </section>
    </div>
  );
}

function CandidateRetryPanel({ candidate }: { candidate: QuarantineCandidateItem }) {
  if (candidate.status !== "identity_unverified") return null;
  return (
    <section className="min-w-0 rounded-lg border border-warning/30 bg-warning/5 p-4">
      <h3 className="text-sm font-medium">Retry safely in an agent run</h3>
      <p className="mt-1 break-words text-xs text-muted-foreground">
        Re-attestation needs a fresh, run-bound browser scope. Open the source thread to coordinate
        a new Network Snowball run, then use list_snowball_candidates before retrying this profile.
      </p>
      <div className="mt-3 flex justify-start">
        <WorkflowRunAgentThreadButton
          runId={candidate.workflowRunId}
          runStatus={candidate.runStatus ?? "completed"}
          agentThread={candidate.agentThread}
        />
      </div>
    </section>
  );
}

function CandidateAttemptHistory({ candidate }: { candidate: QuarantineCandidateItem }) {
  if (candidate.failureHistory.length === 0) return null;
  return (
    <section>
      <h3 className="mb-2 text-sm font-medium">Attempt history</h3>
      <div className="space-y-2">
        {[...candidate.failureHistory].reverse().map((event) => (
          <div
            key={`${event.at}:${event.reason}:${event.message}`}
            className="rounded-lg bg-muted/50 p-3"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-medium capitalize">{formatReason(event.reason)}</p>
              <p className="text-xs text-muted-foreground">
                {formatCandidateTimestamp(event.at)}
              </p>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{event.message}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function CandidatePromotionPanel({ candidate }: { candidate: QuarantineCandidateItem }) {
  if (candidate.status !== "promoted") return null;
  return (
    <section className="rounded-lg border border-success/25 bg-success/5 p-4">
      <div className="flex items-center gap-2 text-sm font-medium text-success">
        <UserCheck className="size-4" /> Promoted to canonical CRM records
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {candidate.promotedContactId ? (
          <Button variant="outline" size="sm" asChild>
            <Link href={`/dashboard/contacts/${candidate.promotedContactId}`}>View contact</Link>
          </Button>
        ) : null}
        {candidate.promotedOrgId ? (
          <Button variant="outline" size="sm" asChild>
            <Link href={`/dashboard/organizations/${candidate.promotedOrgId}`}>View company</Link>
          </Button>
        ) : null}
      </div>
    </section>
  );
}

function CandidateReviewError({ message }: { message: string | null }) {
  if (!message) return null;
  return <p role="alert" className="text-sm text-destructive">{message}</p>;
}

function CandidateReviewFooter({
  candidate,
  updating,
  onUpdate,
}: {
  candidate: QuarantineCandidateItem;
  updating: boolean;
  onUpdate: (action: ReviewAction) => void;
}) {
  return (
    <DialogFooter className="sm:justify-between">
      <p className="self-center text-xs text-muted-foreground">
        Last attempted {formatCandidateTimestamp(candidate.lastAttemptAt)}
      </p>
      <div className="flex flex-col-reverse gap-2 sm:flex-row">
        {candidate.status === "identity_unverified" ? (
          <Button variant="outline" disabled={updating} onClick={() => onUpdate("dismiss")}>
            Dismiss candidate
          </Button>
        ) : null}
        {candidate.status === "dismissed" ? (
          <Button disabled={updating} onClick={() => onUpdate("reopen")}>
            <RotateCcw /> Reopen for verification
          </Button>
        ) : null}
      </div>
    </DialogFooter>
  );
}

export function CandidateReviewDialog({
  candidate,
  open,
  onOpenChange,
}: {
  candidate: QuarantineCandidateItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!candidate) return null;

  async function updateStatus(id: string, action: ReviewAction) {
    setUpdating(true);
    setError(null);
    try {
      await requestCandidateStatusUpdate(id, action);
      onOpenChange(false);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not update candidate");
    } finally {
      setUpdating(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-x-hidden overflow-y-auto sm:max-w-2xl">
        <CandidateDialogHeader candidate={candidate} />
        <CandidateIdentityContext candidate={candidate} />
        <CandidateRetryPanel candidate={candidate} />
        <CandidateAttemptHistory candidate={candidate} />
        <CandidatePromotionPanel candidate={candidate} />
        <CandidateReviewError message={error} />
        <CandidateReviewFooter
          candidate={candidate}
          updating={updating}
          onUpdate={(action) => void updateStatus(candidate.id, action)}
        />
      </DialogContent>
    </Dialog>
  );
}
