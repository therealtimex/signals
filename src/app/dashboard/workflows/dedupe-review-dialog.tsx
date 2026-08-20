"use client";

import { useCallback, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import Link from "next/link";
import { AlertTriangle, ArrowRight, Check, Loader2, Search, Users } from "lucide-react";
import {
  DEDUPE_TIER_PRESETS,
  tiersFromPreset,
  type DedupeTierPreset,
} from "@/lib/workflows/dedupe-template";
import type { DedupeReviewGroup, DedupeReviewMember } from "@/lib/contacts/dedupe/review";
import type { MergeContactsResult } from "@/lib/contacts/dedupe/merge";
import type { RunDedupeMergeResult } from "@/lib/contacts/dedupe/run-merge";

interface DedupeReviewDialogProps {
  open: boolean;
  onClose: () => void;
  templateId: string;
  templateName: string;
}

type MergeOutcome = {
  status: "merged" | "failed";
  detail: string;
};

/** The server's error message when it sent one, without a non-JSON body masking it. */
async function readError(res: Response, fallback: string): Promise<Error> {
  const body = (await res.json().catch(() => null)) as { error?: string } | null;
  return new Error(body?.error || `${fallback} (${res.status})`);
}

/** Groups keep their identity across a merge by primary id — one merge per group. */
function groupKey(group: DedupeReviewGroup): string {
  return `${group.primaryContactId}:${group.secondaryContactIds.join(",")}`;
}

function describeMerge(result: MergeContactsResult): string {
  const merged = result.merged.filter((m) => m.status === "merged").length;
  const already = result.merged.filter((m) => m.status === "already_merged").length;
  const moved = Object.values(result.moved).reduce((sum, count) => sum + count, 0);

  if (merged === 0 && already > 0) return "Already merged";
  const parts = [`${merged} record${merged === 1 ? "" : "s"} merged`];
  if (moved > 0) parts.push(`${moved} row${moved === 1 ? "" : "s"} re-pointed`);
  parts.push(`score ${result.enrichmentScore}`);
  return parts.join(" · ");
}

function MemberRow({ member }: { member: DedupeReviewMember }) {
  const facts = [
    member.email,
    member.company ? [member.title, member.company].filter(Boolean).join(" · ") : member.title,
    ...member.handles,
  ].filter(Boolean) as string[];

  return (
    <div className="flex items-start gap-2 text-xs">
      <Badge
        variant={member.isPrimary ? "default" : "outline"}
        className="mt-0.5 shrink-0 px-1.5 py-0 text-[10px]"
      >
        {member.isPrimary ? "keep" : "merge"}
      </Badge>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate font-medium">{member.name}</span>
          {member.isSelf && (
            <Badge variant="secondary" className="px-1 py-0 text-[10px]">
              You
            </Badge>
          )}
          <span className="shrink-0 text-muted-foreground">score {member.enrichmentScore}</span>
        </div>
        {facts.length > 0 && (
          <div className="truncate text-muted-foreground">{facts.join(" · ")}</div>
        )}
      </div>
    </div>
  );
}

export function DedupeReviewDialog({
  open,
  onClose,
  templateId,
  templateName,
}: DedupeReviewDialogProps) {
  const [preset, setPreset] = useState<DedupeTierPreset>("1");
  const [groups, setGroups] = useState<DedupeReviewGroup[] | null>(null);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingKeys, setPendingKeys] = useState<string[]>([]);
  const [outcomes, setOutcomes] = useState<Record<string, MergeOutcome>>({});
  const [threadPath, setThreadPath] = useState<string | null>(null);
  const [runId, setRunId] = useState<string | null>(null);

  const scan = useCallback(async () => {
    setScanning(true);
    setError(null);
    setOutcomes({});
    try {
      const res = await fetch("/api/contacts/dedupe/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tiers: tiersFromPreset(preset) }),
      });
      if (!res.ok) throw await readError(res, "Scan failed");
      const data = (await res.json()) as { groups?: DedupeReviewGroup[] };
      setGroups(data.groups ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Scan failed");
      setGroups(null);
    } finally {
      setScanning(false);
    }
  }, [preset]);

  const mergeGroups = useCallback(
    async (batch: DedupeReviewGroup[]) => {
      if (batch.length === 0) return;
      const keys = batch.map(groupKey);
      setPendingKeys(keys);
      setError(null);
      try {
        const res = await fetch("/api/contacts/dedupe/merge", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            templateId,
            groups: batch.map((group) => ({
              primaryContactId: group.primaryContactId,
              secondaryContactIds: group.secondaryContactIds,
            })),
          }),
        });
        if (!res.ok) throw await readError(res, "Merge failed");
        const data = (await res.json()) as RunDedupeMergeResult;

        // The server merges in request order, so results line up with the batch.
        setOutcomes((prev) => {
          const next = { ...prev };
          data.groups.forEach((result, index) => {
            next[keys[index]] = result.ok
              ? { status: "merged", detail: describeMerge(result.result) }
              : { status: "failed", detail: result.error };
          });
          return next;
        });
        setThreadPath(data.threadPath ?? null);
        setRunId(data.workflowRunId ?? null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Merge failed");
      } finally {
        setPendingKeys([]);
      }
    },
    [templateId]
  );

  const pendingKeySet = new Set(pendingKeys);
  const pendingGroups = (groups ?? []).filter(
    (group) => outcomes[groupKey(group)]?.status !== "merged"
  );
  const busy = scanning || pendingKeys.length > 0;
  const needsReview = preset !== "1";

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Users className="h-4 w-4" />
            {templateName}
          </DialogTitle>
          <DialogDescription className="text-xs">
            Detection and merging run directly against the contact graph — no agent, no model
            cost. Nothing is archived until you merge a group.
          </DialogDescription>
        </DialogHeader>

        <div className="min-w-0 space-y-4">
          <div className="flex items-end gap-2">
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="review-tiers" className="text-xs">
                Detection tiers
              </Label>
              <Select
                value={preset}
                onValueChange={(value) => setPreset(value as DedupeTierPreset)}
                disabled={busy}
              >
                <SelectTrigger id="review-tiers" className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DEDUPE_TIER_PRESETS.map((option) => (
                    <SelectItem key={option.value} value={option.value} className="text-xs">
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button size="sm" className="h-8" onClick={scan} disabled={busy}>
              {scanning ? (
                <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
              ) : (
                <Search className="mr-1.5 h-3 w-3" />
              )}
              Scan for duplicates
            </Button>
          </div>

          {needsReview && (
            <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
              Tier 2 and 3 are inferred from names and graph overlap — read each group before
              merging it.
            </p>
          )}

          {error && (
            <p className="rounded-md bg-destructive/10 p-2 text-xs text-destructive">{error}</p>
          )}

          {runId && (
            <div className="space-y-1 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-100">
              <p>Recorded as a workflow run — no agent was launched.</p>
              <Link
                href={`/dashboard/workflows/${runId}`}
                className="font-medium underline"
              >
                View run details
              </Link>
              {threadPath && <p className="truncate font-mono">{threadPath}</p>}
            </div>
          )}

          {groups !== null && (
            <>
              <Separator />
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>
                  {groups.length === 0
                    ? "No duplicate groups found."
                    : `${groups.length} group${groups.length === 1 ? "" : "s"} found`}
                </span>
                {pendingGroups.length > 1 && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs"
                    onClick={() => mergeGroups(pendingGroups)}
                    disabled={busy}
                  >
                    {pendingKeys.length > 1 && (
                      <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
                    )}
                    Merge all {pendingGroups.length}
                  </Button>
                )}
              </div>

              <div className="space-y-2">
                {groups.map((group) => {
                  const key = groupKey(group);
                  const outcome = outcomes[key];
                  const merged = outcome?.status === "merged";

                  return (
                    <div
                      key={key}
                      className={`min-w-0 rounded-md border p-3 ${merged ? "opacity-60" : ""}`}
                    >
                      <div className="mb-2 flex min-w-0 items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5">
                          <Badge variant="outline" className="px-1.5 py-0 text-[10px]">
                            Tier {group.tier}
                          </Badge>
                          <span className="text-xs text-muted-foreground">
                            confidence {group.confidence.toFixed(2)}
                          </span>
                        </div>
                        {merged ? (
                          <span className="flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
                            <Check className="h-3 w-3" />
                            {outcome.detail}
                          </span>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs"
                            onClick={() => mergeGroups([group])}
                            disabled={busy}
                          >
                            {pendingKeySet.has(key) ? (
                              <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
                            ) : (
                              <ArrowRight className="mr-1.5 h-3 w-3" />
                            )}
                            Merge
                          </Button>
                        )}
                      </div>

                      <div className="space-y-1.5">
                        {group.members.map((member) => (
                          <MemberRow key={member.contactId} member={member} />
                        ))}
                      </div>

                      <p className="mt-2 truncate text-[11px] text-muted-foreground">
                        {group.reason}
                      </p>

                      {outcome?.status === "failed" && (
                        <p className="mt-1 text-[11px] text-destructive">{outcome.detail}</p>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
