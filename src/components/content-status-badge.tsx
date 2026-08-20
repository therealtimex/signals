import { AlertCircle, Clock, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { getContentStatusPresentation } from "@/components/content-status-badge-utils";

interface ContentStatusBadgeProps {
  status: string | null | undefined;
  activeView?: string;
  stale?: boolean;
}

const statusIcons = {
  clock: Clock,
  loader: Loader2,
  alert: AlertCircle,
};

export function ContentStatusBadge({ status, activeView, stale }: ContentStatusBadgeProps) {
  const presentation = getContentStatusPresentation(status, { activeView });

  return (
    <div className="flex flex-wrap items-center gap-1">
      {presentation && (
        <Badge variant={presentation.tone}>
          {presentation.icon && (() => {
            const Icon = statusIcons[presentation.icon];
            return <Icon className={presentation.icon === "loader" ? "animate-spin motion-reduce:animate-none" : undefined} />;
          })()}
          {presentation.label}
        </Badge>
      )}
      {stale && (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge asChild variant="warning" className="cursor-help px-1.5 py-0 text-[10px]">
                <button
                  type="button"
                  aria-label="Attention: Check the thread — the agent may need input"
                  onClick={(event) => event.stopPropagation()}
                >
                  Attention
                </button>
              </Badge>
            </TooltipTrigger>
            <TooltipContent>Check the thread — the agent may need input</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}
    </div>
  );
}
