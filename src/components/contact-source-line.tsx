import Link from "next/link";
import { formatContactSourceLine } from "@/lib/db/creation-sources";
import type { CreatedSource } from "@/lib/db/creation-sources";
import { cn } from "@/lib/utils";

type ContactSourceLineProps = {
  createdSource: CreatedSource;
  createdSourceDetail: string | null;
  createdWorkflowRunId: string | null;
  createdAt: number;
  createdTemplateName?: string | null;
  runHref?: string | null;
  className?: string;
  compact?: boolean;
};

export function ContactSourceLine({
  createdSource,
  createdSourceDetail,
  createdWorkflowRunId,
  createdAt,
  createdTemplateName,
  runHref,
  className,
  compact = false,
}: ContactSourceLineProps) {
  const text = formatContactSourceLine({
    createdSource,
    createdSourceDetail,
    createdWorkflowRunId,
    createdAt,
    createdTemplateName,
  });
  const addedOn = new Date(createdAt * 1000).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  if (compact) {
    return (
      <p className={cn("text-xs text-muted-foreground", className)} title={text}>
        Added {addedOn}
      </p>
    );
  }

  if (!createdWorkflowRunId) {
    return <p className={cn("text-xs text-muted-foreground", className)}>{text}</p>;
  }

  const runPrefix = `run ${createdWorkflowRunId.slice(0, 8)}`;
  const runIndex = text.indexOf(runPrefix);
  if (runIndex === -1 || !runHref) {
    return <p className={cn("text-xs text-muted-foreground", className)}>{text}</p>;
  }

  const before = text.slice(0, runIndex);
  const after = text.slice(runIndex + runPrefix.length);

  return (
    <p className={cn("text-xs text-muted-foreground", className)}>
      {before}
      <Link href={runHref} className="text-primary hover:underline">
        {runPrefix}
      </Link>
      {after}
    </p>
  );
}
