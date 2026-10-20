"use client";

import { AlertTriangle, ChevronDown, ChevronRight, Info } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  OBJECTIVE_SOURCE_CAPTION,
  RELATIONSHIP_DEFAULT_BODY,
  RELATIONSHIP_ONLY_BODY,
  SOURCES_STALE_TITLE,
  SOURCES_UNAVAILABLE_CAPTION,
  briefSourceCaption,
  customerPainText,
  limitationSentence,
  limitationsShort,
  proofPoints,
  relationBadge,
  sourcesStaleFollowUp,
  sourcesStaleText,
} from "@/app/dashboard/workflows/account-objective-copy";
import { MentionText, ObjectiveMarkdown } from "@/app/dashboard/workflows/account-objective-display";
import type { AccountObjective } from "@/lib/writing/account-objective";
import type { ObjectiveSourceStatus } from "@/lib/writing/objective-sources";
import type { WorkflowRunProposalAsk } from "@/lib/writing/workflow-run-proposals";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1 sm:grid-cols-[10rem_1fr] sm:gap-3">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words text-sm">{children}</dd>
    </div>
  );
}

function Muted({ children }: { children: React.ReactNode }) {
  return <span className="text-muted-foreground">{children}</span>;
}

/** Contract §2 "Sources notice": visible whether the block is expanded or collapsed. */
function SourcesNotice({
  source,
  revoked,
  pendingReview,
}: {
  source: ObjectiveSourceStatus | null;
  revoked: number;
  pendingReview: number;
}) {
  if (!source || source.status === "current") return null;
  if (source.status === "unavailable") {
    return (
      <p className="flex items-start gap-1 text-xs text-muted-foreground" data-testid="objective-sources-unavailable">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span>{SOURCES_UNAVAILABLE_CAPTION}</span>
      </p>
    );
  }
  return (
    <div
      className="space-y-1 rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm"
      data-testid="objective-sources-stale"
    >
      <p className="flex items-start gap-2 font-medium text-warning">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        {SOURCES_STALE_TITLE}
      </p>
      <p className="break-words">{sourcesStaleText(source.changedPaths)}</p>
      <p>{sourcesStaleFollowUp({ revoked, pendingReview }).join(" ")}</p>
    </div>
  );
}

function MentionedFiles({ objective }: { objective: AccountObjective }) {
  return (
    <ul className="space-y-1">
      {objective.mentions.map((mention) => (
        <li key={mention.raw}>
          {mention.resolved ? (
            <details>
              <summary className="cursor-pointer break-words text-xs">
                {mention.resolved.entry ? `${mention.resolved.entry.name} (${mention.raw})` : mention.raw}
              </summary>
              <ObjectiveMarkdown
                content={mention.resolved.excerpt}
                className="mt-1 rounded-md bg-muted p-2"
              />
            </details>
          ) : (
            <p className="flex items-start gap-1 break-words text-xs text-warning">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>{`${mention.raw} — not found`}</span>
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}

function CommercialDetails({ objective }: { objective: AccountObjective }) {
  const parsed = objective.parsed;
  if (!parsed || !objective.brief) return null;
  return (
    <div id="run-objective-details" className="space-y-3">
      <dl className="space-y-2">
        <Row label="Business outcome">
          <MentionText text={parsed.outcome ?? ""} view={objective} />
        </Row>
        <Row label="Offering">
          {objective.offering ? (
            <span>
              <span className="font-medium">{objective.offering.name}</span>
              <Muted>
                {objective.offering.oneLiner ? ` — ${objective.offering.oneLiner}` : ""}
                {` · ${proofPoints(objective.offering.proofPointCount)}`}
              </Muted>
            </span>
          ) : (
            <Muted>None</Muted>
          )}
        </Row>
        <Row label="Fit">
          {parsed.fit ? <MentionText text={parsed.fit} view={objective} /> : <Muted>Not stated</Muted>}
        </Row>
        <Row label="Unknowns">
          {parsed.unknowns.length ? (
            <ol className="list-decimal space-y-0.5 pl-5">
              {parsed.unknowns.map((unknown, index) => (
                <li key={`${index}:${unknown}`}>
                  <MentionText text={unknown} view={objective} />
                </li>
              ))}
            </ol>
          ) : (
            <Muted>None listed</Muted>
          )}
        </Row>
        <Row label="Next step">
          {parsed.nextStep ? <MentionText text={parsed.nextStep} view={objective} /> : <Muted>Not stated</Muted>}
        </Row>
        <Row label="Success">
          {parsed.success ? <MentionText text={parsed.success} view={objective} /> : <Muted>Not defined</Muted>}
        </Row>
        {objective.mentions.length ? (
          <Row label="Mentioned files">
            <MentionedFiles objective={objective} />
          </Row>
        ) : null}
        <Row label="Brief">
          <details>
            <summary className="cursor-pointer text-xs text-muted-foreground">Show the brief as written</summary>
            <ObjectiveMarkdown content={objective.brief.text} view={objective} className="mt-1 rounded-md bg-muted p-2" />
          </details>
        </Row>
      </dl>
      {objective.limitations.length ? (
        <div
          className="space-y-1 rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm"
          data-testid="objective-limits"
        >
          <p className="flex items-start gap-2 font-medium text-warning">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            Limits on these drafts
          </p>
          <ul className="list-disc space-y-0.5 pl-5">
            {objective.limitations.map((code) => (
              <li key={code} className="break-words">{limitationSentence(code, objective)}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

/**
 * The run's stamped objective, above the proposal cards (contract §2). Relationship-only runs have
 * no details to hide; a Business outcome block can be collapsed to its outcome line.
 */
export function RunObjectiveBlock({
  objective,
  objectiveSource,
  revokedForObjective,
  pendingReview,
  open,
  onOpenChange,
}: {
  objective: AccountObjective;
  objectiveSource: ObjectiveSourceStatus | null;
  /** Proposals whose approval was revoked because an objective source changed. */
  revokedForObjective: number;
  pendingReview: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const commercial = objective.kind === "commercial";
  const briefCaption = briefSourceCaption(objective);
  return (
    <Card className="space-y-3 p-4" data-testid="run-objective">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 space-y-1">
          <h3 id="run-objective-heading" className="text-sm font-semibold">Run objective</h3>
          <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <Badge variant={commercial ? "info" : "secondary"}>
              {commercial ? "Business outcome" : "Relationship only"}
            </Badge>
            <span>{OBJECTIVE_SOURCE_CAPTION[objective.source]}</span>
            {commercial && briefCaption ? <span className="break-all">{briefCaption}</span> : null}
          </p>
        </div>
        {commercial ? (
          <Button
            variant="outline"
            size="sm"
            aria-expanded={open}
            aria-controls={open ? "run-objective-details" : undefined}
            onClick={() => onOpenChange(!open)}
          >
            {open ? <ChevronDown className="mr-1 h-3 w-3" /> : <ChevronRight className="mr-1 h-3 w-3" />}
            {open ? "Hide details" : "Show details"}
          </Button>
        ) : null}
      </div>

      {commercial ? (
        <SourcesNotice source={objectiveSource} revoked={revokedForObjective} pendingReview={pendingReview} />
      ) : null}

      {!commercial ? (
        <p className="text-sm text-muted-foreground">
          {objective.source === "default" ? RELATIONSHIP_DEFAULT_BODY : RELATIONSHIP_ONLY_BODY}
        </p>
      ) : open ? (
        <CommercialDetails objective={objective} />
      ) : (
        <div className="space-y-1">
          <p className="break-words text-sm">
            <span className="font-medium">Business outcome: </span>
            <MentionText text={objective.parsed?.outcome ?? ""} view={objective} />
          </p>
          {objective.limitations.length ? (
            <p className="text-xs text-muted-foreground">{`Limits: ${limitationsShort(objective.limitations)}`}</p>
          ) : null}
        </div>
      )}
    </Card>
  );
}

/** The per-card Ask box (contract §3). */
export function ProposalAsk({
  ask,
  objective,
}: {
  ask: WorkflowRunProposalAsk;
  objective: AccountObjective;
}) {
  const badge = relationBadge(ask);
  const unknown = ask.relation === "tests" && ask.testsUncertainty
    ? objective.parsed?.unknowns[ask.testsUncertainty - 1] ?? null
    : null;
  return (
    <div role="group" aria-label="Ask" className="space-y-1 rounded-md border p-3" data-testid="proposal-ask">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold text-muted-foreground">Ask</span>
        <Badge variant={badge.variant}>{badge.label}</Badge>
      </div>
      <p className="break-words text-sm">{ask.statement}</p>
      {unknown ? (
        <p className="break-words text-xs text-muted-foreground">
          <span className="font-medium">Finds out: </span>
          <MentionText text={unknown} view={objective} />
        </p>
      ) : null}
      {ask.relation === "defers" && ask.deferReason ? (
        <p className="break-words text-xs text-muted-foreground">
          <span className="font-medium">Why: </span>
          {ask.deferReason}
        </p>
      ) : null}
      <p className="break-words text-xs text-muted-foreground">
        <span className="font-medium">Customer pain: </span>
        {customerPainText(ask.customerPain)}
      </p>
      {objective.limitations.length ? (
        <p className="text-xs text-muted-foreground">
          <span className="font-medium">Limits: </span>
          {limitationsShort(objective.limitations)}
        </p>
      ) : null}
    </div>
  );
}
