import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { upsertHeartbeatShellTask } from "@/lib/rtx/heartbeat-task-block";

/**
 * Assert the emitted HEARTBEAT.md against RealTimeX's *real* task parser.
 *
 * Four P1s shipped from this writer, all the same shape: the file looked correct
 * and the runtime disagreed. A unit test that inspects our own output cannot
 * catch that — only the parser that actually schedules the task can. See #301.
 *
 * This asserts against a sibling repo's runtime code, so it lives in its own
 * `contract` vitest project and is excluded from `unit`: the default gate must
 * never depend on whether that checkout exists or what state it is in. Run it
 * with `npm run contract:heartbeat`.
 *
 * It skips when the repo is absent, and fails when `RTX_APP_REPO` is set but
 * unusable, so an intentional run cannot silently degrade into a skip.
 */
const PARSER_REL = "server/utils/heartbeat/taskBlock.js";

function resolveAppRepo(): { path: string | null; explicit: boolean } {
  const explicit = process.env.RTX_APP_REPO?.trim();
  if (explicit) return { path: resolve(explicit), explicit: true };

  for (const candidate of [
    resolve(process.cwd(), "../realtimex-ai-app"),
    resolve(process.cwd(), "../../rtgit/realtimex-ai-app"),
    resolve(process.cwd(), "../../realtimex-ai-app"),
  ]) {
    if (existsSync(join(candidate, PARSER_REL))) {
      return { path: candidate, explicit: false };
    }
  }
  return { path: null, explicit: false };
}

const SCOUT = {
  name: "snowball-seed-scout",
  executor: "shell" as const,
  command: "bash ./scripts/snowball-seed-scout/scout.sh",
  interval: "4h",
  timeout: 900,
};

const EXISTING = "morning-brief";

/** `null` expectation means: the writer must refuse and leave the file untouched. */
const SHAPES: Array<{ name: string; content: string; expect: string[] | null }> = [
  {
    name: "block list",
    content: `# H\n\ntasks:\n\n- name: ${EXISTING}\n  agent: claude\n  prompt: keep-me\n  interval: 24h\n`,
    expect: [EXISTING, SCOUT.name],
  },
  {
    name: "empty inline (provisioned starter)",
    content: `# H\n\ntasks: []\n\n## Check\n`,
    expect: [SCOUT.name],
  },
  {
    name: "empty inline, spaced with comment",
    content: `# H\n\ntasks: [ ]   # none yet\n`,
    expect: [SCOUT.name],
  },
  {
    name: "populated inline, loose markdown",
    content: `# H\n\ntasks: [{ name: ${EXISTING}, agent: claude }]\n\n## Check\n`,
    expect: null,
  },
  {
    name: "populated inline, YAML front matter",
    content: `---\ntasks: [{ name: ${EXISTING}, agent: claude }]\n---\n\n# H\n`,
    expect: null,
  },
  {
    name: "front-matter block list",
    content: `---\ntasks:\n  - name: ${EXISTING}\n    agent: claude\n    prompt: p\n---\n\n# H\n`,
    expect: [EXISTING, SCOUT.name],
  },
  {
    name: "no tasks key",
    content: `# H\n\nNothing scheduled.\n`,
    expect: [SCOUT.name],
  },
  {
    name: "heartbeat document",
    content: `# H\n\nheartbeat:\n  enabled: true\ntasks:\n  - name: ${EXISTING}\n    agent: claude\n    prompt: p\n`,
    expect: [EXISTING, SCOUT.name],
  },
  {
    name: "indented example (inert to the locator)",
    content: `# H\n\nExample:\n\n    tasks: [{ name: ex }]\n\ntasks:\n\n- name: ${EXISTING}\n  agent: claude\n  prompt: p\n`,
    expect: [EXISTING, SCOUT.name],
  },
  {
    name: "fenced example (live to the parser, so refused)",
    content: "# H\n\n```yaml\ntasks: [{ name: ex }]\n```\n\ntasks:\n\n- name: " + EXISTING + "\n  agent: claude\n  prompt: p\n",
    expect: null,
  },
];

/** Parse each file with RealTimeX's parser, in its own repo so its deps resolve. */
function parseWithRealtimeX(appRepo: string, files: string[]): Array<string[] | null> {
  const script = `
    const fs = require("fs");
    const { parseTaskBlock } = require("./${PARSER_REL}");
    const out = JSON.parse(process.argv[1]).map((file) => {
      const content = fs.readFileSync(file, "utf8");
      if (content === "__REFUSED__") return null;
      const tasks = parseTaskBlock(content) || [];
      return tasks.map((task) => task.name);
    });
    process.stdout.write(JSON.stringify(out));
  `;
  const result = spawnSync("node", ["-e", script, JSON.stringify(files)], {
    cwd: appRepo,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(
      `RealTimeX parser invocation failed: ${result.stderr || result.stdout}`,
    );
  }
  return JSON.parse(result.stdout) as Array<string[] | null>;
}

const { path: appRepo, explicit } = resolveAppRepo();
const parserPath = appRepo ? join(appRepo, PARSER_REL) : null;
const usable = Boolean(parserPath && existsSync(parserPath));

const misconfigured = explicit && !usable;

describe("HEARTBEAT.md runtime contract", () => {
  // Report misconfiguration as a failing test rather than a module-load throw: a
  // top-level throw takes the whole file's suite down with a cryptic error, and
  // would do the same to any project that happened to include this file.
  it.runIf(misconfigured)("rejects an unusable RTX_APP_REPO", () => {
    expect.fail(
      `RTX_APP_REPO is set to "${process.env.RTX_APP_REPO}" but ${PARSER_REL} was not found there. ` +
        "Point it at a realtimex-ai-app checkout, or unset it to auto-discover one.",
    );
  });
});

describe.skipIf(!usable || misconfigured)("HEARTBEAT.md runtime contract", () => {
  it("emits tasks RealTimeX actually schedules, in both line endings", () => {
    const dir = mkdtempSync(join(tmpdir(), "hb-contract-"));
    const cases: Array<{ label: string; file: string; expect: string[] | null }> = [];

    for (const shape of SHAPES) {
      for (const eol of ["lf", "crlf"] as const) {
        const content =
          eol === "lf" ? shape.content : shape.content.replace(/\n/g, "\r\n");
        const label = `${shape.name} [${eol}]`;

        let after: string;
        try {
          after = upsertHeartbeatShellTask(content, SCOUT);
        } catch {
          after = "__REFUSED__";
        }

        const file = join(dir, `${cases.length}.md`);
        writeFileSync(file, after);
        cases.push({ label, file, expect: shape.expect });
      }
    }

    const parsed = parseWithRealtimeX(appRepo as string, cases.map((c) => c.file));

    // Collect every mismatch rather than aborting on the first: the value of a
    // matrix is seeing which shapes broke together, not just the earliest one.
    const failures: string[] = [];
    cases.forEach((testCase, index) => {
      const actual = parsed[index];
      if (testCase.expect === null) {
        if (actual !== null) {
          failures.push(
            `${testCase.label}: expected a refusal, but the writer wrote a file RealTimeX reads as [${actual.join(", ") || "none"}]`,
          );
        }
        return;
      }
      if (actual === null) {
        failures.push(`${testCase.label}: refused, expected ${testCase.expect.join(", ")}`);
        return;
      }
      for (const name of testCase.expect) {
        if (!actual.includes(name)) {
          failures.push(
            `${testCase.label}: RealTimeX sees [${actual.join(", ") || "none"}], missing "${name}"`,
          );
        }
      }
    });

    expect(failures, failures.join("\n")).toEqual([]);
  });

  it("emits the scout as an executable shell task", () => {
    const dir = mkdtempSync(join(tmpdir(), "hb-contract-exec-"));
    const file = join(dir, "HEARTBEAT.md");
    writeFileSync(file, upsertHeartbeatShellTask("# H\n\ntasks: []\n", SCOUT));

    const script = `
      const fs = require("fs");
      const { parseTaskBlock } = require("./${PARSER_REL}");
      const tasks = parseTaskBlock(fs.readFileSync(process.argv[1], "utf8")) || [];
      process.stdout.write(JSON.stringify(tasks.find((t) => t.name === ${JSON.stringify(SCOUT.name)}) || null));
    `;
    const result = spawnSync("node", ["-e", script, file], {
      cwd: appRepo as string,
      encoding: "utf8",
    });
    expect(result.status, result.stderr).toBe(0);

    // Visible to the runtime is not enough — it has to be runnable.
    const task = JSON.parse(result.stdout) as Record<string, unknown> | null;
    expect(task).not.toBeNull();
    expect(task?.executor).toBe("shell");
    expect(task?.command).toBe(SCOUT.command);
    expect(task?.interval).toBe("4h");
  });
});
