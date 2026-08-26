export interface HeartbeatShellTask {
  name: string;
  interval?: string | null;
  cron?: string | null;
  executor: "shell";
  command: string;
  cwd?: string | null;
  timeout?: string | number | null;
}

export const HEARTBEAT_FILENAME = "HEARTBEAT.md";

const TASKS_HEADER = "tasks:";

function unquoteScalar(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseTaskItem(lines: string[]): HeartbeatShellTask | null {
  if (lines.length === 0) return null;

  const task: Partial<HeartbeatShellTask> = { executor: "shell" };
  for (const line of lines) {
    const nameMatch = line.match(/^- name:\s*(.*)$/);
    if (nameMatch) {
      task.name = unquoteScalar(nameMatch[1]);
      continue;
    }

    const match = line.match(/^\s{2,}([a-zA-Z]+)\s*:\s*(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    const value = unquoteScalar(rawValue);
    switch (key) {
      case "name":
        task.name = value;
        break;
      case "interval":
        task.interval = value || null;
        break;
      case "cron":
        task.cron = value || null;
        break;
      case "executor":
        task.executor = "shell";
        break;
      case "command":
        task.command = value;
        break;
      case "cwd":
        task.cwd = value || null;
        break;
      case "timeout":
        task.timeout = value || null;
        break;
      default:
        break;
    }
  }

  if (!task.name || !task.command) return null;
  return task as HeartbeatShellTask;
}

export function parseHeartbeatShellTasks(content: string): HeartbeatShellTask[] {
  const lines = content.split("\n");
  const tasksIndex = lines.findIndex((line) => line.trim() === TASKS_HEADER);
  if (tasksIndex < 0) return [];

  const tasks: HeartbeatShellTask[] = [];
  let currentTaskLines: string[] = [];

  for (let index = tasksIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];

    if (line.startsWith("- name:")) {
      if (currentTaskLines.length > 0) {
        const parsed = parseTaskItem(currentTaskLines);
        if (parsed) tasks.push(parsed);
      }
      currentTaskLines = [line];
      continue;
    }

    if (currentTaskLines.length > 0) {
      if (line.trim() === "" && currentTaskLines.length > 1) {
        const parsed = parseTaskItem(currentTaskLines);
        if (parsed) tasks.push(parsed);
        currentTaskLines = [];
        continue;
      }
      currentTaskLines.push(line);
    }
  }

  if (currentTaskLines.length > 0) {
    const parsed = parseTaskItem(currentTaskLines);
    if (parsed) tasks.push(parsed);
  }

  return tasks;
}

function serializeTask(task: HeartbeatShellTask): string {
  const lines = [
    `- name: ${task.name}`,
    `  executor: shell`,
    `  command: ${task.command}`,
  ];

  if (task.interval) {
    lines.push(`  interval: ${task.interval}`);
  }
  if (task.cron) {
    lines.push(`  cron: ${task.cron}`);
  }
  if (task.cwd) {
    lines.push(`  cwd: ${task.cwd}`);
  }
  if (task.timeout != null && String(task.timeout).trim()) {
    lines.push(`  timeout: ${task.timeout}`);
  }

  return lines.join("\n");
}

function splitHeartbeatContent(content: string): {
  beforeTasks: string;
  afterTasks: string;
} {
  const lines = content.split("\n");
  const tasksIndex = lines.findIndex((line) => line.trim() === TASKS_HEADER);
  if (tasksIndex < 0) {
    return { beforeTasks: content.trimEnd(), afterTasks: "" };
  }

  // Consume every consecutive task block, including the blank lines separating
  // them, so that tasks after the first are not left behind in `afterTasks` and
  // re-emitted alongside the serialized task list.
  let afterIndex = tasksIndex + 1;
  while (afterIndex < lines.length) {
    let blockStart = afterIndex;
    while (blockStart < lines.length && lines[blockStart].trim() === "") {
      blockStart += 1;
    }
    if (blockStart >= lines.length || !lines[blockStart].startsWith("- name:")) {
      break;
    }

    let blockEnd = blockStart;
    while (blockEnd < lines.length && lines[blockEnd].trim() !== "") {
      blockEnd += 1;
    }

    // Trailing prose can legitimately start with a `- name:` bullet. Only treat
    // the block as a task if it carries task fields, so documentation after the
    // tasks section is preserved rather than swallowed.
    const isTaskBlock = lines
      .slice(blockStart + 1, blockEnd)
      .some((line) => /^\s+(executor|command|interval|cron):/.test(line));
    if (!isTaskBlock) {
      break;
    }

    afterIndex = blockEnd;
  }

  return {
    beforeTasks: lines.slice(0, tasksIndex + 1).join("\n").trimEnd(),
    afterTasks: lines.slice(afterIndex).join("\n").trim(),
  };
}

export function upsertHeartbeatShellTask(
  content: string,
  task: HeartbeatShellTask,
): string {
  const { beforeTasks, afterTasks } = splitHeartbeatContent(content);
  const existingTasks = content.trim() ? parseHeartbeatShellTasks(content) : [];
  const taskMap = new Map(existingTasks.map((entry) => [entry.name, entry]));
  taskMap.set(task.name, task);
  const nextTasks = [...taskMap.values()];

  const taskBlock = nextTasks.map((entry) => serializeTask(entry)).join("\n\n");
  const parts = [beforeTasks || TASKS_HEADER, "", taskBlock];
  if (afterTasks) {
    parts.push("", afterTasks);
  }
  return `${parts.join("\n")}\n`;
}

export function defaultHeartbeatSkeleton(): string {
  return [
    "# Heartbeat Instructions",
    "",
    "## Mission",
    "",
    "Signals Snowball Seed Scout harvests candidate post URLs and queues Network Snowball runs on the calendar.",
    "",
    TASKS_HEADER,
  ].join("\n");
}
