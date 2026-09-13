import Link from "next/link";
import { ArrowLeft, CalendarClock, CircleUserRound, Link2Off } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { PriorityBadge } from "@/components/priority-badge";
import { getTaskById } from "@/lib/db/queries/tasks";
import { getContactById } from "@/lib/db/queries/contacts";
import { getOrgById } from "@/lib/db/queries/orgs";

function formatTaskLabel(value: string): string {
  return value.replaceAll("_", " ").replace(/^\w/, (letter) => letter.toUpperCase());
}

const taskDateFormatter = new Intl.DateTimeFormat("en", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "UTC",
});

function formatTaskDate(timestamp: number | null): string | null {
  if (timestamp === null) return null;
  return taskDateFormatter.format(new Date(timestamp * 1_000));
}

export default async function TaskDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const task = getTaskById(id);

  if (!task) {
    return (
      <div className="space-y-6">
        <Link
          href="/dashboard#pending-tasks"
          className="inline-flex items-center gap-2 rounded-sm text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          Back to pending tasks
        </Link>
        <Card>
          <CardHeader>
            <h1 className="text-heading-2 font-semibold">Task unavailable</h1>
            <CardDescription>
              This task may have been completed or deleted since the dashboard loaded.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline">
              <Link href="/dashboard#pending-tasks">Return to pending tasks</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const relatedContact = task.relatedContactId ? getContactById(task.relatedContactId) : null;
  const relatedOrg = task.relatedOrgId ? getOrgById(task.relatedOrgId) : null;
  const dueAt = formatTaskDate(task.dueAt);

  return (
    <div className="space-y-6">
      <Link
        href="/dashboard#pending-tasks"
        className="inline-flex items-center gap-2 rounded-sm text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Back to pending tasks
      </Link>

      <Card>
        <CardHeader className="gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <PriorityBadge priority={task.priority} />
            <Badge variant="secondary">{formatTaskLabel(task.status)}</Badge>
            <Badge variant="outline">{formatTaskLabel(task.taskType)}</Badge>
          </div>
          <h1 className="text-heading-2 font-semibold">{task.title}</h1>
          <CardDescription>
            Assigned to {task.assignee === "agent" ? "an agent" : "you"}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {task.description ? (
            <p className="whitespace-pre-wrap text-sm">{task.description}</p>
          ) : (
            <p className="text-sm text-muted-foreground">No additional task details.</p>
          )}

          {dueAt ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <CalendarClock className="size-4" aria-hidden="true" />
              <span>Due {dueAt} UTC</span>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <h2 className="text-heading-3 font-semibold">Related records</h2>
          <CardDescription>Open the CRM context linked to this task.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {task.relatedContactId ? (
            relatedContact ? (
              <Button asChild variant="outline">
                <Link href={`/dashboard/contacts/${relatedContact.id}`}>
                  <CircleUserRound aria-hidden="true" />
                  Open contact: {relatedContact.name}
                </Link>
              </Button>
            ) : (
              <div className="space-y-2" role="status">
                <p className="flex items-center gap-2 text-sm font-medium">
                  <Link2Off className="size-4" aria-hidden="true" />
                  Related contact unavailable
                </p>
                <p className="text-sm text-muted-foreground">
                  The linked contact may have been deleted. The task remains available above.
                </p>
                <Link
                  href="/dashboard/contacts"
                  className="inline-flex rounded-sm text-sm text-primary underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  Browse contacts
                </Link>
              </div>
            )
          ) : null}

          {task.relatedOrgId ? (
            relatedOrg ? (
              <Button asChild variant="outline">
                <Link href={`/dashboard/organizations/${relatedOrg.id}`}>
                  Open organization: {relatedOrg.name}
                </Link>
              </Button>
            ) : (
              <div className="space-y-2" role="status">
                <p className="flex items-center gap-2 text-sm font-medium">
                  <Link2Off className="size-4" aria-hidden="true" />
                  Related organization unavailable
                </p>
                <p className="text-sm text-muted-foreground">
                  The linked organization may have been deleted. The task remains available above.
                </p>
                <Link
                  href="/dashboard/organizations"
                  className="inline-flex rounded-sm text-sm text-primary underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  Browse organizations
                </Link>
              </div>
            )
          ) : null}

          {!task.relatedContactId && !task.relatedOrgId ? (
            <p className="text-sm text-muted-foreground">
              This task has no linked CRM record. Its full details above are the available work
              context.
            </p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
