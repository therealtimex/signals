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

    // The other half of the upsert contract: untouched sibling tasks survive
    // intact, exactly once, in their original order.
    expect(tasks.map((task) => task.name)).toEqual([
      "snowball-seed-scout",
      "other-task",
    ]);
    const otherTasks = tasks.filter((task) => task.name === "other-task");
    expect(otherTasks).toHaveLength(1);
    expect(otherTasks[0]?.command).toBe("echo hi");
    expect(otherTasks[0]?.interval).toBe("30m");
    expect(next.match(/- name: other-task/g)).toHaveLength(1);
  });

  it("does not duplicate trailing tasks when several already exist", () => {
    const initial = `${defaultHeartbeatSkeleton()}
- name: first-task
  executor: shell
  command: echo first
  interval: 1h

- name: second-task
  executor: shell
  command: echo second
  interval: 2h

- name: third-task
  executor: shell
  command: echo third
  interval: 3h
`;

    const next = upsertHeartbeatShellTask(initial, {
      name: "snowball-seed-scout",
      executor: "shell",
      command: "bash ./scripts/snowball-seed-scout/scout.sh",
      interval: "4h",
      timeout: 900,
    });

    expect(next.match(/- name: second-task/g)).toHaveLength(1);
    expect(next.match(/- name: third-task/g)).toHaveLength(1);
    expect(parseHeartbeatShellTasks(next).map((task) => task.name)).toEqual([
      "first-task",
      "second-task",
      "third-task",
      "snowball-seed-scout",
    ]);
  });

  it("preserves content that follows the tasks section", () => {
    const initial = `${defaultHeartbeatSkeleton()}
- name: first-task
  executor: shell
  command: echo first
  interval: 1h

- name: second-task
  executor: shell
  command: echo second
  interval: 2h

## Notes

Keep this trailing section.
`;

    const next = upsertHeartbeatShellTask(initial, {
      name: "snowball-seed-scout",
      executor: "shell",
      command: "bash ./scripts/snowball-seed-scout/scout.sh",
      interval: "4h",
      timeout: 900,
    });

    expect(next).toContain("## Notes");
    expect(next).toContain("Keep this trailing section.");
    expect(next.match(/- name: second-task/g)).toHaveLength(1);
  });
});
