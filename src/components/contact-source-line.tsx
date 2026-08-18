import Link from "next/link";
import { formatContactSourceLine } from "@/lib/db/creation-sources";
import type { CreatedSource } from "@/lib/db/creation-sources";

type ContactSourceLineProps = {
  createdSource: CreatedSource;
  createdSourceDetail: string | null;
  createdWorkflowRunId: string | null;
  createdAt: number;
  createdTemplateName?: string | null;
  runHref?: string | null;
};

export function ContactSourceLine({
  createdSource,
  createdSourceDetail,
  createdWorkflowRunId,
  createdAt,
  createdTemplateName,
  runHref,
}: ContactSourceLineProps) {
  const text = formatContactSourceLine({
    createdSource,
    createdSourceDetail,
    createdWorkflowRunId,
    createdAt,
    createdTemplateName,
  });

  if (!createdWorkflowRunId) {
    return <p className="text-sm text-muted-foreground">{text}</p>;
  }

  const runPrefix = `run ${createdWorkflowRunId.slice(0, 8)}`;
  const runIndex = text.indexOf(runPrefix);
  if (runIndex === -1 || !runHref) {
    return <p className="text-sm text-muted-foreground">{text}</p>;
  }

  const before = text.slice(0, runIndex);
  const after = text.slice(runIndex + runPrefix.length);

  return (
    <p className="text-sm text-muted-foreground">
      {before}
      <Link href={runHref} className="text-primary hover:underline">
        {runPrefix}
      </Link>
      {after}
    </p>
  );
}
