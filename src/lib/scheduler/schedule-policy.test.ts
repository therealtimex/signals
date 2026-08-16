import { describe, expect, it } from "vitest";
import {
  canReactivateScheduleLocally,
  canToggleScheduleEnabled,
  isAgentTemplateSchedule,
  scheduledJobNextRunLabel,
  type SchedulePolicyJob,
} from "@/lib/scheduler/schedule-policy";

function baseJob(overrides: Partial<SchedulePolicyJob> = {}): SchedulePolicyJob {
  return {
    templateId: null,
    enabled: 1,
    status: "pending",
    runAt: 1_700_000_000,
    ...overrides,
  };
}

describe("schedule-policy", () => {
  it("identifies agent template schedules by templateId", () => {
    expect(isAgentTemplateSchedule(baseJob({ templateId: "tpl-1" }))).toBe(true);
    expect(isAgentTemplateSchedule(baseJob())).toBe(false);
  });

  it("blocks local reactivation for agent template schedules", () => {
    const templateJob = baseJob({ templateId: "tpl-1", status: "failed", enabled: 0 });
    expect(canReactivateScheduleLocally(templateJob)).toBe(false);
    expect(canReactivateScheduleLocally(baseJob({ status: "failed", enabled: 0 }))).toBe(true);
  });

  it("blocks only re-enable for agent template schedules", () => {
    const templateJob = baseJob({ templateId: "tpl-1", status: "failed", enabled: 0 });
    expect(canToggleScheduleEnabled(templateJob, true)).toBe(false);
    expect(canToggleScheduleEnabled(templateJob, false)).toBe(true);

    const maintenanceFailed = baseJob({ status: "failed", enabled: 0 });
    expect(canToggleScheduleEnabled(maintenanceFailed, true)).toBe(true);
  });

  it("shows RTX scheduling guidance instead of re-enable for template jobs", () => {
    const templateFailed = baseJob({
      templateId: "tpl-1",
      status: "failed",
      enabled: 0,
    });
    expect(
      scheduledJobNextRunLabel(templateFailed, (ts) => `at ${ts}`),
    ).toBe("Schedule in RTX Agent Flow");

    const maintenanceFailed = baseJob({ status: "failed", enabled: 0 });
    expect(scheduledJobNextRunLabel(maintenanceFailed, () => "never")).toBe(
      "Re-enable to schedule",
    );

    const active = baseJob({ runAt: 42 });
    expect(scheduledJobNextRunLabel(active, (ts) => `at ${ts}`)).toBe("at 42");
  });
});
