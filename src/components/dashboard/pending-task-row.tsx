import Link from "next/link";
import { PriorityBadge } from "@/components/priority-badge";
import type { PendingTaskDestination } from "@/lib/dashboard/pending-task-destination";
import type { Task } from "@/lib/db/types";

const rowClassName =
  "flex items-center justify-between rounded-lg p-2.5 transition-colors hover:bg-accent/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function PendingTaskRow({
  task,
  destination,
}: {
  task: Pick<Task, "id" | "title" | "description" | "priority">;
  destination: PendingTaskDestination;
}) {
  const body = (
    <>
      <div className="min-w-0">
        <p className="text-sm font-medium truncate">{task.title}</p>
        {task.description ? (
          <p className="text-xs text-muted-foreground truncate">{task.description}</p>
        ) : null}
      </div>
      <PriorityBadge priority={task.priority} />
    </>
  );

  return (
    <Link
      href={destination.href}
      aria-label={destination.accessibleName}
      className={rowClassName}
    >
      {body}
    </Link>
  );
}
