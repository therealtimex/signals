import { describe, expect, it } from "vitest";
import {
  canReactivateScheduleLocally,
  isAgentTemplateSchedule,
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
});
