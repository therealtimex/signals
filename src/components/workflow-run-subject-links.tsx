import Link from "next/link";
import type { WorkflowRunSubject } from "@/lib/workflows/workflow-run-subjects-shared";

export function WorkflowRunSubjectLinks({
  subjects,
  workflowRunHref,
  maxVisible = 2,
}: {
  subjects: WorkflowRunSubject[];
  workflowRunHref?: string;
  maxVisible?: number;
}) {
  if (subjects.length === 0) {
    return <span className="text-muted-foreground">—</span>;
  }

  const visible = subjects.slice(0, maxVisible);
  const remaining = subjects.length - visible.length;

  return (
    <div className="flex flex-col items-end gap-0.5 text-xs">
      {visible.map((subject) => (
        <Link
          key={`${subject.kind}-${subject.id}`}
          href={subject.href}
          className="max-w-[180px] truncate text-primary hover:underline"
          title={subject.label}
          onClick={(event) => event.stopPropagation()}
        >
          {subject.label}
        </Link>
      ))}
      {remaining > 0 && workflowRunHref ? (
        <Link
          href={`${workflowRunHref}${workflowRunHref.includes("#") ? "" : "#run-subjects"}`}
          className="text-muted-foreground hover:underline"
          onClick={(event) => event.stopPropagation()}
        >
          +{remaining} more
        </Link>
      ) : null}
    </div>
  );
}
