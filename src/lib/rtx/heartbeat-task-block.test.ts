import { describe, expect, it } from "vitest";
import {
  defaultHeartbeatSkeleton,
  findUnsupportedTasksRepresentation,
  parseHeartbeatShellTasks,
  upsertHeartbeatShellTask,
} from "@/lib/rtx/heartbeat-task-block";


/**
 * RealTimeX's `parseFromMarkdownBody` locator, replicated exactly: find a line
 * matching `/^tasks\s*:\s*$/` and read until the next markdown heading. Asserting
 * against this is the point — a file that looks right but misses this regex
 * schedules nothing while Deploy reports success.
 */
function tasksVisibleToRealtimeX(content: string): string[] {
  const lines = content.split("\n");
  const tasksIdx = lines.findIndex((l) => /^tasks\s*:\s*$/.test(l));
  if (tasksIdx === -1) return [];

  const blockLines: string[] = [];
  for (let i = tasksIdx + 1; i < lines.length; i += 1) {
    if (/^#{1,6}\s/.test(lines[i])) break;
    blockLines.push(lines[i]);
  }
  return blockLines
    .filter((line) => /^\s*-\s*name:/.test(line))
    .map((line) => line.replace(/^\s*-\s*name:\s*/, "").trim());
}

/** The provisioned RealTimeX starter, verbatim in shape. */
const REALTIMEX_STARTER = `# Heartbeat Instructions

## Mission

Describe the ambient agent's standing responsibility.

## Tasks

The scheduler evaluates this \`tasks:\` block on every heartbeat tick and runs only tasks that are due.

tasks: []

## Check for

- Pending tasks that require follow-up

## When action is needed

Do the thing.
`;

describe("heartbeat task block", () => {
  it("schedules the scout in the RealTimeX starter's `tasks: []` heartbeat", () => {
    const next = upsertHeartbeatShellTask(REALTIMEX_STARTER, {
      name: "snowball-seed-scout",
      executor: "shell",
      command: "bash ./scripts/snowball-seed-scout/scout.sh",
      interval: "4h",
      timeout: 900,
    });

    // The whole point: the runtime must actually see the task.
    expect(tasksVisibleToRealtimeX(next)).toEqual(["snowball-seed-scout"]);
    // Exactly one usable key, and the empty inline sequence is gone.
    expect(next.split("\n").filter((l) => /^tasks\s*:\s*$/.test(l))).toHaveLength(1);
    expect(next).not.toContain("tasks: []");
    // Surrounding document is preserved.
    expect(next).toContain("## Mission");
    expect(next).toContain("## Check for");
    expect(next).toContain("Do the thing.");
  });

  it("inserts a tasks key into a nonempty file that has none", () => {
    const initial = `# Heartbeat Instructions

## Mission

Nothing scheduled yet.
`;

    const next = upsertHeartbeatShellTask(initial, {
      name: "snowball-seed-scout",
      executor: "shell",
      command: "bash ./scripts/snowball-seed-scout/scout.sh",
      interval: "4h",
      timeout: 900,
    });

    expect(tasksVisibleToRealtimeX(next)).toEqual(["snowball-seed-scout"]);
    expect(next.split("\n").filter((l) => /^tasks\s*:\s*$/.test(l))).toHaveLength(1);
    expect(next).toContain("Nothing scheduled yet.");
  });

  it("keeps the scout visible to the runtime alongside an existing agent task", () => {
    const initial = `# Heartbeat Instructions

tasks:

- name: morning-brief
  agent: claude
  prompt: Summarise overnight activity
  interval: 24h

## Notes

Trailing prose.
`;

    const next = upsertHeartbeatShellTask(initial, {
      name: "snowball-seed-scout",
      executor: "shell",
      command: "bash ./scripts/snowball-seed-scout/scout.sh",
      interval: "4h",
      timeout: 900,
    });

    expect(tasksVisibleToRealtimeX(next)).toEqual([
      "morning-brief",
      "snowball-seed-scout",
    ]);
    expect(next).toContain("Trailing prose.");
  });

  it("re-deploys idempotently against the starter shape", () => {
    const once = upsertHeartbeatShellTask(REALTIMEX_STARTER, {
      name: "snowball-seed-scout",
      executor: "shell",
      command: "bash ./scripts/snowball-seed-scout/scout.sh",
      interval: "4h",
      timeout: 900,
    });
    const twice = upsertHeartbeatShellTask(once, {
      name: "snowball-seed-scout",
      executor: "shell",
      command: "bash ./scripts/snowball-seed-scout/scout.sh",
      interval: "4h",
      timeout: 900,
    });

    expect(twice).toBe(once);
    expect(tasksVisibleToRealtimeX(twice)).toEqual(["snowball-seed-scout"]);
  });

  it("refuses a populated inline task array rather than appending a second key", () => {
    // Loose markdown: appending a bare `tasks:` would win the locator and drop
    // the user's existing task entirely.
    const initial = `# Heartbeat

tasks: [{ name: morning-brief, agent: claude, prompt: keep-me, interval: 24h }]

## Check for
`;

    expect(findUnsupportedTasksRepresentation(initial)).toContain("inline list");
    expect(() =>
      upsertHeartbeatShellTask(initial, {
        name: "snowball-seed-scout",
        executor: "shell",
        command: "bash ./scripts/snowball-seed-scout/scout.sh",
        interval: "4h",
        timeout: 900,
      }),
    ).toThrow(/inline list/);
  });

  it("refuses a populated inline array inside YAML front matter", () => {
    // Front matter wins over the markdown body, so an appended key would leave
    // the scout silently unscheduled while deploy reported success.
    const initial = `---
tasks: [{ name: morning-brief, agent: claude, prompt: keep-me, interval: 24h }]
---

# Heartbeat
`;

    expect(findUnsupportedTasksRepresentation(initial)).toContain("inline list");
    expect(() =>
      upsertHeartbeatShellTask(initial, {
        name: "snowball-seed-scout",
        executor: "shell",
        command: "bash ./scripts/snowball-seed-scout/scout.sh",
        interval: "4h",
        timeout: 900,
      }),
    ).toThrow(/inline list/);
  });

  it("detects a populated inline array in a CRLF file", () => {
    // `.` never matches `\r` in JS, so a naive per-line regex silently fails to
    // match and falls through to the duplicate-key append this guard prevents.
    const lf = `# Heartbeat\n\ntasks: [{ name: morning-brief, agent: claude, prompt: keep-me }]\n`;
    const crlf = lf.replace(/\n/g, "\r\n");

    expect(findUnsupportedTasksRepresentation(crlf)).toContain("inline list");
    expect(() =>
      upsertHeartbeatShellTask(crlf, {
        name: "snowball-seed-scout",
        executor: "shell",
        command: "bash ./s.sh",
        interval: "4h",
        timeout: 900,
      }),
    ).toThrow(/inline list/);
  });

  it("preserves CRLF line endings when it does write", () => {
    const crlf = `# Heartbeat\r\n\r\ntasks:\r\n\r\n- name: morning-brief\r\n  agent: claude\r\n  prompt: keep-me\r\n`;
    const next = upsertHeartbeatShellTask(crlf, {
      name: "snowball-seed-scout",
      executor: "shell",
      command: "bash ./s.sh",
      interval: "4h",
      timeout: 900,
    });

    expect(next).toContain("\r\n");
    expect(next.split("\n").every((l) => l === "" || l.endsWith("\r"))).toBe(true);
    expect(next).toContain("- name: morning-brief");
    expect(next).toContain("- name: snowball-seed-scout");
    // Exactly one key, and it still matches RealTimeX's locator with the \r.
    expect(
      next.split("\n").filter((l) => /^tasks\s*:\s*$/.test(l)),
    ).toHaveLength(1);
  });

  it("accepts every spelling of an empty task list", () => {
    for (const value of ["tasks: []", "tasks: [ ]", "tasks: []   # none yet", "tasks:   [  ]  "]) {
      expect(findUnsupportedTasksRepresentation(`# h\n\n${value}\n`)).toBeNull();
    }
  });

  it("ignores a tasks example inside a fenced code block", () => {
    // Documentation must not block a deploy; RealTimeX's locator ignores it too.
    const initial = `# Heartbeat

Example of the unsupported form:

\`\`\`yaml
tasks: [{ name: example, agent: claude }]
\`\`\`

tasks:

- name: morning-brief
  agent: claude
  prompt: keep-me
`;

    expect(findUnsupportedTasksRepresentation(initial)).toBeNull();
    const next = upsertHeartbeatShellTask(initial, {
      name: "snowball-seed-scout",
      executor: "shell",
      command: "bash ./s.sh",
      interval: "4h",
      timeout: 900,
    });
    expect(next).toContain("- name: snowball-seed-scout");
    expect(next).toContain("- name: morning-brief");
  });

  it("accepts every representation it can round-trip", () => {
    // Guard against the refusal over-reaching: these must stay deployable.
    const supported = [
      "tasks:\n\n- name: a\n  executor: shell\n  command: echo a\n",
      "tasks: []\n",
      "---\ntasks:\n  - name: a\n    agent: claude\n    prompt: p\n---\n",
      "# Heartbeat\n\nNothing scheduled.\n",
      "heartbeat:\n  enabled: true\ntasks:\n  - name: a\n    agent: claude\n    prompt: p\n",
      // A `tasks:` mention inside an indented block scalar is not a key.
      "tasks:\n\n- name: a\n  agent: claude\n  prompt: |\n    tasks: [not, a, key]\n",
    ];
    for (const content of supported) {
      expect(findUnsupportedTasksRepresentation(content)).toBeNull();
    }
  });

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

  it("preserves an existing agent task that has no shell command", () => {
    const initial = `${defaultHeartbeatSkeleton()}
- name: morning-brief
  agent: claude
  prompt: Summarise overnight activity
  interval: 24h
`;

    const next = upsertHeartbeatShellTask(initial, {
      name: "snowball-seed-scout",
      executor: "shell",
      command: "bash ./scripts/snowball-seed-scout/scout.sh",
      interval: "4h",
      timeout: 900,
    });

    // Agent tasks are not shell tasks, so they are invisible to the parser. They
    // must survive verbatim regardless — dropping them is workspace data loss.
    expect(next).toContain("- name: morning-brief");
    expect(next).toContain("agent: claude");
    expect(next).toContain("prompt: Summarise overnight activity");
    expect(next).toContain("interval: 24h");
    expect(next).toContain("- name: snowball-seed-scout");
  });

  it("preserves a multiline prompt block scalar", () => {
    const initial = `${defaultHeartbeatSkeleton()}
- name: digest
  agent: claude
  prompt: |
    First line.

    Second line after a blank.
  model: claude-opus-5
  interval: 12h
`;

    const next = upsertHeartbeatShellTask(initial, {
      name: "snowball-seed-scout",
      executor: "shell",
      command: "bash ./scripts/snowball-seed-scout/scout.sh",
      interval: "4h",
      timeout: 900,
    });

    expect(next).toContain("First line.");
    expect(next).toContain("Second line after a blank.");
    expect(next).toContain("model: claude-opus-5");
    expect(next.match(/- name: digest/g)).toHaveLength(1);
  });

  it("preserves unmodelled keys on the task being replaced's siblings", () => {
    const initial = `${defaultHeartbeatSkeleton()}
- name: other
  executor: shell
  command: echo hi
  interval: 1h
  provider: local
  skills:
    - alpha
    - beta
`;

    const next = upsertHeartbeatShellTask(initial, {
      name: "snowball-seed-scout",
      executor: "shell",
      command: "bash ./scripts/snowball-seed-scout/scout.sh",
      interval: "4h",
      timeout: 900,
    });

    expect(next).toContain("provider: local");
    expect(next).toContain("- alpha");
    expect(next).toContain("- beta");
  });

  it("round-trips a YAML-indented task list", () => {
    const initial = `${defaultHeartbeatSkeleton()}
  - name: existing
    agent: claude
    prompt: keep me
    interval: 6h
`;

    const next = upsertHeartbeatShellTask(initial, {
      name: "snowball-seed-scout",
      executor: "shell",
      command: "bash ./scripts/snowball-seed-scout/scout.sh",
      interval: "4h",
      timeout: 900,
    });

    expect(next).toContain("  - name: existing");
    expect(next).toContain("prompt: keep me");
    // The new task adopts the file's existing indentation.
    expect(next).toContain("  - name: snowball-seed-scout");
    expect(next).toContain("    command: bash ./scripts/snowball-seed-scout/scout.sh");
  });

  it("replaces the scout task without disturbing an adjacent agent task", () => {
    const initial = `${defaultHeartbeatSkeleton()}
- name: snowball-seed-scout
  executor: shell
  command: bash ./old.sh
  interval: 1h

- name: nightly-agent
  agent: claude
  prompt: do the thing
  interval: 24h
`;

    const next = upsertHeartbeatShellTask(initial, {
      name: "snowball-seed-scout",
      executor: "shell",
      command: "bash ./scripts/snowball-seed-scout/scout.sh",
      interval: "6h",
      timeout: 900,
    });

    expect(next).toContain("command: bash ./scripts/snowball-seed-scout/scout.sh");
    expect(next).not.toContain("bash ./old.sh");
    expect(next).toContain("- name: nightly-agent");
    expect(next).toContain("prompt: do the thing");
    expect(next.match(/- name: nightly-agent/g)).toHaveLength(1);
  });

  it("keeps scanning past a YAML comment between task items", () => {
    const initial = `${defaultHeartbeatSkeleton()}
- name: first-task
  executor: shell
  command: echo first
  interval: 1h

# managed by Signals — do not edit below
- name: snowball-seed-scout
  executor: shell
  command: bash ./old.sh
  interval: 1h
`;

    const next = upsertHeartbeatShellTask(initial, {
      name: "snowball-seed-scout",
      executor: "shell",
      command: "bash ./scripts/snowball-seed-scout/scout.sh",
      interval: "4h",
      timeout: 900,
    });

    // Stopping at the comment would strand the scout task in trailing content
    // and append a second copy.
    expect(next.match(/- name: snowball-seed-scout/g)).toHaveLength(1);
    expect(next).toContain("bash ./scripts/snowball-seed-scout/scout.sh");
    expect(next).not.toContain("bash ./old.sh");
    expect(next).toContain("# managed by Signals");
  });

  it("still treats a markdown heading as the end of the section", () => {
    const initial = `${defaultHeartbeatSkeleton()}
- name: first-task
  executor: shell
  command: echo first
  interval: 1h

## Notes

Prose that happens to mention tasks.
`;

    const next = upsertHeartbeatShellTask(initial, {
      name: "snowball-seed-scout",
      executor: "shell",
      command: "bash ./scripts/snowball-seed-scout/scout.sh",
      interval: "4h",
      timeout: 900,
    });

    expect(next).toContain("## Notes");
    expect(next).toContain("Prose that happens to mention tasks.");
    expect(next.match(/- name: first-task/g)).toHaveLength(1);
    expect(next).toContain("- name: snowball-seed-scout");
  });

  it("collapses pre-existing duplicate task names to a single entry", () => {
    // An earlier revision of this function could emit duplicates, so a real
    // HEARTBEAT.md may already contain them. Deploy must restore the invariant.
    const initial = `${defaultHeartbeatSkeleton()}
- name: snowball-seed-scout
  executor: shell
  command: bash ./old-a.sh
  interval: 1h

- name: keep-me
  executor: shell
  command: echo keep
  interval: 2h

- name: snowball-seed-scout
  executor: shell
  command: bash ./old-b.sh
  interval: 3h
`;

    const next = upsertHeartbeatShellTask(initial, {
      name: "snowball-seed-scout",
      executor: "shell",
      command: "bash ./scripts/snowball-seed-scout/scout.sh",
      interval: "4h",
      timeout: 900,
    });

    expect(next.match(/- name: snowball-seed-scout/g)).toHaveLength(1);
    expect(next).not.toContain("old-a.sh");
    expect(next).not.toContain("old-b.sh");
    expect(next).toContain("- name: keep-me");
    // The survivor keeps the first occurrence's position.
    expect(next.indexOf("snowball-seed-scout")).toBeLessThan(next.indexOf("keep-me"));
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
