import { describe, expect, it } from "vitest";
import { resolvePendingTaskDestination } from "@/lib/dashboard/pending-task-destination";

describe("resolvePendingTaskDestination", () => {
  it("uses the task's stable id without inferring another population", () => {
    expect(
      resolvePendingTaskDestination({ id: "task/with spaces", title: "Follow up" }),
    ).toEqual({
      kind: "task",
      href: "/dashboard/tasks/task%2Fwith%20spaces",
      accessibleName: "Open task: Follow up",
    });
  });
});
