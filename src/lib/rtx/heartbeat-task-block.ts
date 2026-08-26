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

function serializeTask(task: HeartbeatShellTask, indent = ""): string {
  const lines = [
    `${indent}- name: ${task.name}`,
    `${indent}  executor: shell`,
    `${indent}  command: ${task.command}`,
  ];

  if (task.interval) {
    lines.push(`${indent}  interval: ${task.interval}`);
  }
  if (task.cron) {
    lines.push(`${indent}  cron: ${task.cron}`);
  }
  if (task.cwd) {
    lines.push(`${indent}  cwd: ${task.cwd}`);
  }
  if (task.timeout != null && String(task.timeout).trim()) {
    lines.push(`${indent}  timeout: ${task.timeout}`);
  }

  return lines.join("\n");
}

interface HeartbeatTaskSection {
  /** Everything up to and including the `tasks:` header. */
  before: string;
  /** Raw text of each task item, untouched. */
  blocks: string[];
  /** Content following the tasks section. */
  after: string;
  /** Indentation of the list items, so re-serialization matches the file. */
  indent: string;
}

/**
 * Split the tasks section into raw item blocks.
 *
 * The blocks are kept as text rather than parsed structures: HEARTBEAT.md holds
 * agent tasks, multiline prompts, and provider/model options this module does
 * not model, and rebuilding the section from a shell-task parse would delete all
 * of it. Only the block being upserted is ever rewritten.
 */
function splitHeartbeatTaskSection(content: string): HeartbeatTaskSection {
  const lines = content.split("\n");
  const tasksIndex = lines.findIndex((line) => line.trim() === TASKS_HEADER);
  if (tasksIndex < 0) {
    return { before: content.trimEnd(), blocks: [], after: "", indent: "" };
  }

  // The section runs until a line that is clearly outside it: non-blank, at
  // column 0, and not a list item (a new top-level key or a markdown heading).
  let sectionEnd = tasksIndex + 1;
  while (sectionEnd < lines.length) {
    const line = lines[sectionEnd];
    if (line.trim() !== "" && !/^\s/.test(line) && !/^-\s/.test(line)) break;
    sectionEnd += 1;
  }

  const sectionLines = lines.slice(tasksIndex + 1, sectionEnd);
  const firstItem = sectionLines.find((line) => /^\s*-\s/.test(line));
  const indent = firstItem ? (firstItem.match(/^\s*/)?.[0] ?? "") : "";
  // Anchor splits to the exact list indentation so a `- ` inside a multiline
  // block scalar does not look like a new task.
  const itemPattern = new RegExp(`^${indent}-\\s`);

  const blocks: string[] = [];
  let current: string[] | null = null;
  for (const line of sectionLines) {
    if (itemPattern.test(line)) {
      if (current) blocks.push(current.join("\n").trimEnd());
      current = [line];
      continue;
    }
    if (current) current.push(line);
  }
  if (current) blocks.push(current.join("\n").trimEnd());

  return {
    before: lines.slice(0, tasksIndex + 1).join("\n").trimEnd(),
    blocks,
    after: lines.slice(sectionEnd).join("\n").trim(),
    indent,
  };
}

/** Name of a raw task block, or null when the block has no `- name:` line. */
function taskBlockName(block: string): string | null {
  const match = block.split("\n")[0]?.match(/^\s*-\s*name:\s*(.*)$/);
  return match ? unquoteScalar(match[1]) : null;
}

export function upsertHeartbeatShellTask(
  content: string,
  task: HeartbeatShellTask,
): string {
  const section = splitHeartbeatTaskSection(content);
  const serialized = serializeTask(task, section.indent);

  const existingIndex = section.blocks.findIndex(
    (block) => taskBlockName(block) === task.name,
  );

  const blocks = [...section.blocks];
  if (existingIndex >= 0) {
    // Replace in place so ordering — and every sibling block — is preserved.
    blocks[existingIndex] = serialized;
  } else {
    blocks.push(serialized);
  }

  const parts = [section.before || TASKS_HEADER, "", blocks.join("\n\n")];
  if (section.after) {
    parts.push("", section.after);
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
