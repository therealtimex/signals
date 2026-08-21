import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const stageColors: Record<string, string> = {
  prospect: "bg-chart-1/15 text-chart-1 border-chart-1/25",
  engaged: "bg-chart-2/15 text-chart-2 border-chart-2/25",
  qualified: "bg-chart-5/15 text-chart-5 border-chart-5/25",
  opportunity: "bg-chart-3/15 text-chart-3 border-chart-3/25",
  customer: "bg-chart-4/15 text-chart-4 border-chart-4/25",
  advocate: "bg-primary/10 text-primary border-primary/20",
};

export function FunnelStageBadge({ stage }: { stage: string }) {
  return (
    <Badge variant="outline" className={cn("font-medium", stageColors[stage] ?? "bg-muted/15 text-muted-foreground border-muted")}>
      {stage.replaceAll("_", " ").replace(/^\w/, (letter) => letter.toUpperCase())}
    </Badge>
  );
}
