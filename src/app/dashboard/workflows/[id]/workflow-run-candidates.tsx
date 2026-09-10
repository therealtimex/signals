import { CheckCircle2, ExternalLink, ShieldAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import type { SnowballCandidateView } from "@/lib/workflows/snowball-candidates";

function statusLabel(status: SnowballCandidateView["status"]): string {
  if (status === "promoted") return "Promoted";
  if (status === "dismissed") return "Dismissed";
  return "Needs verification";
}

function failureLabel(reason: string): string {
  return reason.replaceAll("_", " ");
}

export function WorkflowRunCandidates({
  candidates,
}: {
  candidates: SnowballCandidateView[];
}) {
  if (candidates.length === 0) return null;
  const awaitingVerification = candidates.filter(
    (candidate) => candidate.status === "identity_unverified",
  ).length;

  return (
    <section className="space-y-3" data-testid="snowball-candidate-quarantine">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-medium">Candidate quarantine</h2>
          <p className="text-xs text-muted-foreground">
            Preserved discoveries stay outside contacts and the relationship graph until verified.
          </p>
        </div>
        <Badge variant={awaitingVerification > 0 ? "outline" : "secondary"}>
          {awaitingVerification} awaiting verification
        </Badge>
      </div>

      <Card className="divide-y">
        {candidates.map((candidate) => {
          const promoted = candidate.status === "promoted";
          return (
            <article key={candidate.id} className="flex gap-3 p-4">
              <div className="mt-0.5 rounded-md bg-muted p-2">
                {promoted ? (
                  <CheckCircle2 className="h-4 w-4 text-green-600" />
                ) : (
                  <ShieldAlert className="h-4 w-4 text-amber-600" />
                )}
              </div>
              <div className="min-w-0 flex-1 space-y-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium">{candidate.proposedName}</p>
                  <Badge variant={promoted ? "secondary" : "outline"}>
                    {statusLabel(candidate.status)}
                  </Badge>
                </div>
                {(candidate.proposedTitle || candidate.proposedCompany) && (
                  <p className="text-sm text-muted-foreground">
                    {[candidate.proposedTitle, candidate.proposedCompany]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                )}
                <p className="text-xs text-muted-foreground">
                  Gate: {failureLabel(candidate.failureReason)} · {candidate.attemptCount}{" "}
                  {candidate.attemptCount === 1 ? "attempt" : "attempts"}
                </p>
                {candidate.seedValue && (
                  <p className="truncate text-xs text-muted-foreground">
                    Source: {candidate.seedValue}
                  </p>
                )}
              </div>
              <a
                href={candidate.profileUrl}
                target="_blank"
                rel="noreferrer"
                aria-label={`Open ${candidate.proposedName} on LinkedIn`}
                className="mt-1 text-muted-foreground hover:text-foreground"
              >
                <ExternalLink className="h-4 w-4" />
              </a>
            </article>
          );
        })}
      </Card>
      {awaitingVerification > 0 && (
        <p className="text-xs text-muted-foreground">
          Use list_snowball_candidates from an active enrichment or Network Snowball run to re-attest these leads.
        </p>
      )}
    </section>
  );
}
