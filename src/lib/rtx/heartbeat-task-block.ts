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

/**
 * RealTimeX locates the block with `/^tasks\s*:\s*$/` and reads until the next
 * markdown heading, so the emitted key must sit at column 0 with nothing after
 * the colon. `tasks: []` — the shape in the provisioned starter — does not match
 * it, and a file with no key at all matches nothing, so both have to be
 * normalized into a real list or Deploy reports success while scheduling nothing.
 */
const TASKS_KEY_PATTERN = /^tasks\s*:\s*(.*)$/;

/** Strip a trailing YAML comment so `tasks: [] # none` reads as an empty list. */
function stripInlineComment(value: string): string {
  return value.replace(/(^|\s)#.*$/, "$1").trim();
}

/**
 * Inline values we can safely expand into a block list: absent, or any spelling
 * of an empty flow sequence (`[]`, `[ ]`, with or without a trailing comment).
 */
function isExpandableTasksValue(value: string): boolean {
  const trimmed = stripInlineComment(value);
  return trimmed === "" || /^\[\s*\]$/.test(trimmed);
}

/** CRLF files must parse identically; `.` never matches `\r` in JS. */
function toLf(content: string): string {
  return content.replace(/\r\n/g, "\n");
}

/** Preserve the file's existing newline style on write. */
function detectEol(content: string): string {
  return content.includes("\r\n") ? "\r\n" : "\n";
}

/**
 * Describe a `tasks:` representation this module must not edit, or null when the
 * file is safe to write.
 *
 * A populated inline flow sequence (`tasks: [{ name: ... }]`) cannot be merged
 * into without a YAML round-trip. Treating it as "no key present" is not a safe
 * fallback: appending a second `tasks:` key makes RealTimeX resolve only one of
 * them, which either drops the user's existing task (loose markdown, where the
 * appended key wins) or silently fails to schedule the scout (front matter,
 * where the original wins). Refusing to write is the only outcome that loses
 * nothing.
 *
 * Matching is anchored to column 0, mirroring RealTimeX's own locator, so a
 * `tasks:` line inside an indented prompt block scalar is not mistaken for a key.
 */
export function findUnsupportedTasksRepresentation(
  content: string,
): string | null {
  // Only a column-0 marker opens a markdown fence, and only its own delimiter
  // closes it. Matching indented markers would let a ``` inside a prompt block
  // scalar open a phantom fence that swallows the real key below it, and
  // toggling on the other delimiter would do the same — both fall through to the
  // duplicate-key append this guard exists to prevent.
  let fence: { delimiter: string; length: number } | null = null;
  for (const line of toLf(content).split("\n")) {
    const marker = line.match(/^(`{3,}|~{3,})(.*)$/);
    if (marker) {
      const delimiter = marker[1][0];
      const length = marker[1].length;
      const info = marker[2].trim();
      if (fence === null) {
        fence = { delimiter, length };
      } else if (
        // CommonMark: a fence closes only on its own delimiter, a run at least
        // as long as the opening one, and no info string. Closing on a shorter
        // run would end a ```` block at a nested ```, dropping back out of the
        // fence and skipping a real key below it.
        delimiter === fence.delimiter &&
        length >= fence.length &&
        info === ""
      ) {
        fence = null;
      }
      continue;
    }
    // A fenced example is documentation, not a key. RealTimeX's own locator only
    // accepts an empty value, so a fenced populated array is inert to it too —
    // refusing on one would block a deploy that is perfectly safe.
    if (fence) continue;

    const match = line.match(TASKS_KEY_PATTERN);
    if (!match || isExpandableTasksValue(match[1])) continue;
    return `HEARTBEAT.md declares tasks as an inline list (\`tasks: ${stripInlineComment(match[1])}\`), which cannot be edited safely. Rewrite it as an indented block list (\`tasks:\` on its own line, one \`- name:\` item per task) and deploy again.`;
  }
  return null;
}

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
  /** False when the file has no usable `tasks:` key and one must be inserted. */
  hasHeader: boolean;
}

/**
 * Whether this line ends the tasks section.
 *
 * `#` is ambiguous in a HEARTBEAT.md: it opens a YAML comment inside the block
 * and a markdown heading after it. Treat it as a comment only when another task
 * item still follows — ending the section early would strand later tasks in the
 * trailing content and let the upsert append a duplicate.
 */
function endsTaskSection(lines: string[], index: number): boolean {
  const line = lines[index];
  if (line.trim() === "") return false;
  // Indented lines and list items are part of the block.
  if (/^\s/.test(line) || /^-\s/.test(line)) return false;

  if (line.startsWith("#")) {
    for (let probe = index + 1; probe < lines.length; probe += 1) {
      const next = lines[probe];
      if (next.trim() === "" || next.startsWith("#")) continue;
      return !/^\s*-\s*name:/.test(next);
    }
    return true;
  }

  // Any other unindented content is a new top-level key or prose.
  return true;
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
  const lines = toLf(content).split("\n");
  const tasksIndex = lines.findIndex((line) => {
    const match = line.match(TASKS_KEY_PATTERN);
    return match ? isExpandableTasksValue(match[1]) : false;
  });
  if (tasksIndex < 0) {
    // No usable key. Preserve the file verbatim; the caller inserts one.
    return {
      before: content.trimEnd(),
      blocks: [],
      after: "",
      indent: "",
      hasHeader: false,
    };
  }

  // Normalize `tasks: []` to a bare key so the emitted file matches the locator.
  const headerLines = lines.slice(0, tasksIndex + 1);
  headerLines[tasksIndex] = TASKS_HEADER;

  let sectionEnd = tasksIndex + 1;
  while (sectionEnd < lines.length && !endsTaskSection(lines, sectionEnd)) {
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
    before: headerLines.join("\n").trimEnd(),
    blocks,
    after: lines.slice(sectionEnd).join("\n").trim(),
    indent,
    hasHeader: true,
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
  // Guard here as well as at the caller: silently appending a second `tasks:`
  // key is worse than refusing, so no caller may reach that path by accident.
  const unsupported = findUnsupportedTasksRepresentation(content);
  if (unsupported) {
    throw new Error(unsupported);
  }

  const eol = detectEol(content);
  const section = splitHeartbeatTaskSection(content);
  const serialized = serializeTask(task, section.indent);

  // Replace the first block with this name in place so ordering — and every
  // sibling block — is preserved, and drop any further blocks sharing the name.
  // A file can already hold duplicates (an earlier revision of this function
  // produced them), and leaving the extras behind keeps them scheduled.
  const blocks: string[] = [];
  let replaced = false;
  for (const block of section.blocks) {
    if (taskBlockName(block) === task.name) {
      if (!replaced) {
        blocks.push(serialized);
        replaced = true;
      }
      continue;
    }
    blocks.push(block);
  }
  if (!replaced) {
    blocks.push(serialized);
  }

  const parts: string[] = [];
  if (section.hasHeader) {
    parts.push(section.before || TASKS_HEADER);
  } else if (section.before) {
    // Append the key after the existing document rather than guessing a spot
    // inside it; nothing follows, so the block cannot be cut short by a heading.
    parts.push(section.before, "", TASKS_HEADER);
  } else {
    parts.push(TASKS_HEADER);
  }
  parts.push("", blocks.join("\n\n"));
  if (section.after) {
    parts.push("", section.after);
  }
  const next = `${parts.join("\n")}\n`;
  return eol === "\n" ? next : next.replace(/\n/g, eol);
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
