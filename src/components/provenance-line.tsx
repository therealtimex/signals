import Link from "next/link";
import { Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { ProvenanceSummary } from "@/lib/orgs/provenance";

export function ProvenanceLine({ provenance }: { provenance: ProvenanceSummary }) {
  const details = [
    provenance.sourceDetail ? `Source: ${provenance.sourceDetail}` : null,
    provenance.templateId ? `Template: ${provenance.templateId}` : null,
  ].filter(Boolean);

  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
      <span>{provenance.label}</span>
      <span aria-hidden="true">·</span>
      <span>{provenance.dateLabel}</span>
      {provenance.runId ? (
        <>
          <span aria-hidden="true">·</span>
          <Link
            href={`/dashboard/workflows/runs/${provenance.runId}`}
            className="text-primary hover:underline"
          >
            View run
          </Link>
        </>
      ) : null}
      {details.length > 0 ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="size-5" aria-label="Provenance details">
              <Info className="size-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{details.join(" · ")}</TooltipContent>
        </Tooltip>
      ) : null}
    </div>
  );
}
