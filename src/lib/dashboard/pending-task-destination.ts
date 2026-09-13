import type { Task } from "@/lib/db/types";

export type PendingTaskDestination = {
  kind: "task";
  href: string;
  accessibleName: string;
};

/**
 * Every row resolves through its own durable task id. The task detail surface
 * can then expose a supported related-record link or an explicit unavailable
 * state without guessing that unrelated populations (for example, an equal
 * quarantine count) share identity.
 */
export function resolvePendingTaskDestination(task: Pick<
  Task,
  "id" | "title"
>): PendingTaskDestination {
  return {
    kind: "task",
    href: `/dashboard/tasks/${encodeURIComponent(task.id)}`,
    accessibleName: `Open task: ${task.title}`,
  };
}
