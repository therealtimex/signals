import type { ContactExplorePersona } from "@/lib/db/queries/contact-explore";
import { formatRelativeGeneratedAt } from "@/components/explore/explore-format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Loader2 } from "lucide-react";

type ExplorePersonaSectionProps = {
  persona: ContactExplorePersona;
  generating: boolean;
  error: string | null;
  onGenerate: (force: boolean) => void;
};

export function ExplorePersonaSection({
  persona,
  generating,
  error,
  onGenerate,
}: ExplorePersonaSectionProps) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle className="text-base">Persona</CardTitle>
        <div className="flex items-center gap-2">
          {persona.visibility === "shared" && persona.stale && (
            <Badge variant="destructive">Stale</Badge>
          )}
          {persona.visibility === "shared" ? (
            persona.stale ? (
              <Button size="sm" onClick={() => onGenerate(false)} disabled={generating}>
                {generating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Refresh persona
              </Button>
            ) : (
              <Button
                size="sm"
                variant="outline"
                onClick={() => onGenerate(true)}
                disabled={generating}
              >
                {generating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Regenerate
              </Button>
            )
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {persona.visibility === "absent" && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">No shared persona yet.</p>
            <Button onClick={() => onGenerate(false)} disabled={generating}>
              {generating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Generate persona
            </Button>
          </div>
        )}
        {persona.visibility === "local_only" && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <div
                  className="space-y-2"
                  title="This contact has a private persona. Re-scope it before generating a shared one."
                >
                  <Badge variant="outline">Private persona</Badge>
                  <p className="text-sm text-muted-foreground">
                    A persona exists for this contact but is marked local-only and is not shown here.
                  </p>
                </div>
              </TooltipTrigger>
              <TooltipContent>
                This contact has a private persona. Re-scope it before generating a shared one.
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
        {persona.visibility === "shared" && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                {persona.archetype && <Badge variant="secondary">{persona.archetype}</Badge>}
                {persona.tone && (
                  <span className="text-sm text-muted-foreground">Tone: {persona.tone}</span>
                )}
                {persona.confidence != null && (
                  <span className="text-xs text-muted-foreground">
                    Confidence {(persona.confidence * 100).toFixed(0)}%
                  </span>
                )}
              </div>
              {persona.summary && <p className="text-sm">{persona.summary}</p>}
              {persona.interests.length > 0 && (
                <ChipRow label="Interests" items={persona.interests} />
              )}
              {persona.conversionTriggers.length > 0 && (
                <ChipRow label="What converts them" items={persona.conversionTriggers} />
              )}
              {persona.engagementFormats.length > 0 && (
                <ChipRow label="Formats they engage with" items={persona.engagementFormats} />
              )}
              {persona.generatedAt != null && (
                <p className="text-xs text-muted-foreground">
                  Generated {formatRelativeGeneratedAt(persona.generatedAt)}
                </p>
              )}
            </div>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}

function ChipRow({ label, items }: { label: string; items: string[] }) {
  return (
    <div className="space-y-1">
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {items.map((item) => (
          <Badge key={item} variant="outline">
            {item}
          </Badge>
        ))}
      </div>
    </div>
  );
}
