"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { CalendarClock, Trash2, Loader2 } from "lucide-react";

interface ScheduledJob {
  id: string;
  jobType: string;
  templateId: string | null;
  cronExpression: string | null;
  enabled: number;
  status: string;
  runAt: number;
  lastTriggeredAt: number | null;
  payload: string | null;
  error: string | null;
  createdAt: number;
}

interface TemplateMap {
  [id: string]: string;
}

function formatCron(cron: string | null): string {
  if (!cron) return "—";
  const presets: Record<string, string> = {
    "0 9 * * *": "Daily at 9:00 AM",
    "0 9 * * 1-5": "Weekdays at 9:00 AM",
    "0 9 * * 1": "Weekly on Monday",
    "0 9 1 * *": "Monthly on the 1st",
  };
  return presets[cron] ?? cron;
}

function formatTimestamp(ts: number | null): string {
  if (!ts) return "—";
  return new Date(ts * 1000).toLocaleString();
}

function statusBadge(job: ScheduledJob) {
  if (job.status === "failed") {
    return (
      <Badge variant="destructive" className="text-[10px]">
        Failed
      </Badge>
    );
  }
  if (job.enabled !== 1) {
    return (
      <Badge variant="secondary" className="text-[10px]">
        Disabled
      </Badge>
    );
  }
  if (job.status === "pending") {
    return (
      <Badge variant="default" className="bg-green-600 text-[10px]">
        Active
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="text-[10px] capitalize">
      {job.status}
    </Badge>
  );
}

function formatNextRun(job: ScheduledJob): string {
  if (job.status === "failed" || job.enabled !== 1) {
    return "Re-enable to schedule";
  }
  return formatTimestamp(job.runAt);
}

function truncateError(error: string | null, max = 80): string | null {
  if (!error) return null;
  if (error.length <= max) return error;
  return `${error.slice(0, max - 1)}…`;
}

export function ScheduledJobsList() {
  const router = useRouter();
  const [jobs, setJobs] = useState<ScheduledJob[]>([]);
  const [templateNames, setTemplateNames] = useState<TemplateMap>({});
  const [loading, setLoading] = useState(true);

  function refreshJobs() {
    Promise.all([
      fetch("/api/workflows/schedule").then((r) => r.json()),
      fetch("/api/workflows/templates?pageSize=50").then((r) => r.json()),
    ])
      .then(([scheduleData, templateData]) => {
        setJobs(scheduleData.data ?? []);
        const names: TemplateMap = {};
        for (const t of templateData.data ?? []) {
          names[t.id] = t.name;
        }
        setTemplateNames(names);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }

  useEffect(() => { refreshJobs(); }, []);

  useEffect(() => {
    const handler = () => refreshJobs();
    window.addEventListener("schedule-changed", handler);
    return () => window.removeEventListener("schedule-changed", handler);
  }, []);

  async function handleToggle(jobId: string, currentEnabled: number) {
    const newEnabled = currentEnabled !== 1;
    const res = await fetch(`/api/workflows/schedule/${jobId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: newEnabled }),
    });
    if (!res.ok) return;
    const job = (await res.json()) as ScheduledJob;
    setJobs((prev) => prev.map((j) => (j.id === jobId ? job : j)));
  }

  async function handleDelete(jobId: string) {
    await fetch(`/api/workflows/schedule/${jobId}`, { method: "DELETE" });
    setJobs((prev) => prev.filter((j) => j.id !== jobId));
    router.refresh();
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-4">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (jobs.length === 0) return null;

  return (
    <div className="space-y-3">
      <h2 className="text-lg font-semibold flex items-center gap-2">
        <CalendarClock className="h-4 w-4" />
        Scheduled Workflows
      </h2>
      <Card>
        <div className="rounded-md">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Template</TableHead>
                <TableHead>Schedule</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Next Run</TableHead>
                <TableHead>Last Run</TableHead>
                <TableHead className="w-20">Enabled</TableHead>
                <TableHead className="w-16" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {jobs.map((job) => (
                <TableRow key={job.id}>
                  <TableCell className="font-medium">
                    <div className="space-y-1">
                      <div>
                        {job.templateId
                          ? templateNames[job.templateId] ?? "Unknown"
                          : "—"}
                      </div>
                      {job.error && (
                        <p className="text-xs text-destructive font-normal">
                          {truncateError(job.error)}
                        </p>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="font-mono text-xs">
                      {formatCron(job.cronExpression)}
                    </Badge>
                  </TableCell>
                  <TableCell>{statusBadge(job)}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {formatNextRun(job)}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {formatTimestamp(job.lastTriggeredAt)}
                  </TableCell>
                  <TableCell>
                    <Switch
                      checked={job.enabled === 1}
                      onCheckedChange={() =>
                        handleToggle(job.id, job.enabled)
                      }
                    />
                  </TableCell>
                  <TableCell>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8">
                          <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Delete schedule?</AlertDialogTitle>
                          <AlertDialogDescription>
                            This will permanently remove this recurring schedule.
                            It will not affect previous workflow runs.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={() => handleDelete(job.id)}
                          >
                            Delete
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Card>
    </div>
  );
}
