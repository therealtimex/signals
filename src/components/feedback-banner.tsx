"use client";

import type { ReactNode } from "react";
import { AlertCircle, CheckCircle2, Info, TriangleAlert, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type FeedbackTone = "info" | "success" | "warning" | "danger";

interface FeedbackBannerProps {
  tone?: FeedbackTone;
  children?: ReactNode;
  action?: ReactNode;
  onDismiss?: () => void;
  className?: string;
}

const toneStyles: Record<FeedbackTone, string> = {
  info: "border-info/25 bg-info/10",
  success: "border-success/25 bg-success/10",
  warning: "border-warning/30 bg-warning/10",
  danger: "border-danger/25 bg-danger/10",
};

const iconStyles: Record<FeedbackTone, string> = {
  info: "text-info",
  success: "text-success",
  warning: "text-warning",
  danger: "text-danger",
};

const toneIcons = {
  info: Info,
  success: CheckCircle2,
  warning: TriangleAlert,
  danger: AlertCircle,
};

export function FeedbackBanner({
  tone = "info",
  children,
  action,
  onDismiss,
  className,
}: FeedbackBannerProps) {
  const Icon = toneIcons[tone];
  return (
    <div
      role={tone === "danger" ? "alert" : "status"}
      className={cn("flex items-start gap-3 rounded-lg border px-4 py-3 text-sm", toneStyles[tone], className)}
    >
      <Icon aria-hidden="true" className={cn("mt-0.5 size-4 shrink-0", iconStyles[tone])} />
      <div className="min-w-0 flex-1 text-foreground">{children}</div>
      {action && <div className="shrink-0">{action}</div>}
      {onDismiss && (
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className="-mr-1 -mt-1 shrink-0"
          aria-label="Dismiss"
          onClick={onDismiss}
        >
          <X />
        </Button>
      )}
    </div>
  );
}
