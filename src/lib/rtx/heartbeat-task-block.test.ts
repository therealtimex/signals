import { describe, expect, it } from "vitest";
import {
  defaultHeartbeatSkeleton,
  parseHeartbeatShellTasks,
  upsertHeartbeatShellTask,
} from "@/lib/rtx/heartbeat-task-block";

describe("heartbeat task block", () => {
  it("inserts tasks section when missing", () => {
    const next = upsertHeartbeatShellTask("", {
      name: "snowball-seed-scout",
      executor: "shell",
      command: "bash ./scripts/snowball-seed-scout/scout.sh",
      interval: "4h",
      timeout: 900,
    });

    expect(next).toContain("tasks:");
    expect(next).toContain("name: snowball-seed-scout");
    expect(next).toContain("interval: 4h");
  });

  it("replaces an existing task by name", () => {
    const initial = `${defaultHeartbeatSkeleton()}
- name: snowball-seed-scout
  executor: shell
  command: bash ./old.sh
  interval: 1h

- name: other-task
  executor: shell
  command: echo hi
  interval: 30m
`;

    const next = upsertHeartbeatShellTask(initial, {
      name: "snowball-seed-scout",
      executor: "shell",
      command: "bash ./scripts/snowball-seed-scout/scout.sh",
      interval: "6h",
      timeout: 900,
    });

    const tasks = parseHeartbeatShellTasks(next);
    const scoutTasks = tasks.filter((task) => task.name === "snowball-seed-scout");
    expect(scoutTasks).toHaveLength(1);
    expect(scoutTasks[0]?.interval).toBe("6h");
    expect(scoutTasks[0]?.command).toContain("scout.sh");
  });
});
