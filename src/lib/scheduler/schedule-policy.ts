export const RTX_SCHEDULING_REQUIRED_CODE = "RTX_SCHEDULING_REQUIRED";

export const RTX_SCHEDULING_REQUIRED_MESSAGE =
  "Agent template schedules no longer run inside Signals. Configure recurring runs in a RealTimeX Agent Flow instead of re-enabling this local schedule.";

export type SchedulePolicyJob = {
  templateId: string | null;
  status: string;
  enabled: number;
  runAt: number;
};

/** Template-backed gallery schedules always route through removed in-process orchestration. */
export function isAgentTemplateSchedule(job: SchedulePolicyJob): boolean {
  return Boolean(job.templateId);
}

export function canReactivateScheduleLocally(job: SchedulePolicyJob): boolean {
  return !isAgentTemplateSchedule(job);
}

export function scheduledJobNextRunLabel(
  job: SchedulePolicyJob,
  formatRunAt: (runAt: number) => string,
): string {
  if (isAgentTemplateSchedule(job) && (job.status === "failed" || job.enabled !== 1)) {
    return "Schedule in RTX Agent Flow";
  }
  if (job.status === "failed" || job.enabled !== 1) {
    return "Re-enable to schedule";
  }
  return formatRunAt(job.runAt);
}

export function canToggleScheduleEnabled(job: SchedulePolicyJob, targetEnabled: boolean): boolean {
  if (targetEnabled && !canReactivateScheduleLocally(job)) {
    return false;
  }
  return true;
}
