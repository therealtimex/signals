import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PersonalityWorkspace } from "@/lib/personality/workspace";
import {
  isObjectiveBriefName,
  listSavedObjectiveBriefs,
  parseObjectiveBriefPath,
  readSavedObjectiveBrief,
  writeSavedObjectiveBrief,
} from "@/lib/rtx/objective-brief-files";

let root = "";
let workspace: PersonalityWorkspace;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "signals-objective-briefs-"));
  workspace = { slug: "signals", id: "workspace-test", dir: root, key: "test" };
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("saved Objective briefs", () => {
  it("enforces the name grammar and objectives/ confinement", () => {
    expect(isObjectiveBriefName("eng-workflow-founders")).toBe(true);
    for (const name of ["a", "-lead", "Upper", "../escape", "has.dot", "preview", "mentions", "x".repeat(64)]) {
      expect(isObjectiveBriefName(name)).toBe(false);
    }
    expect(parseObjectiveBriefPath("objectives/eng.md")).toBe("eng");
    for (const path of ["objectives/../BRAND.md", "BRAND.md", "objectives/sub/eng.md", "objectives/eng.txt"]) {
      expect(parseObjectiveBriefPath(path)).toBeNull();
    }
  });

  it("writes exclusively, refuses an existing name with objective_exists, and overwrites only on request", () => {
    const saved = writeSavedObjectiveBrief(workspace, { name: "eng-founders", text: "## Outcome\nBook an evaluation." });
    expect(saved).toMatchObject({ name: "eng-founders", path: "objectives/eng-founders.md", outcome: "Book an evaluation." });
    expect(readFileSync(join(root, "objectives", "eng-founders.md"), "utf8")).toBe("## Outcome\nBook an evaluation.");

    expect(() => writeSavedObjectiveBrief(workspace, { name: "eng-founders", text: "replacement" }))
      .toThrow(expect.objectContaining({ code: "CONFLICT", details: expect.objectContaining({ reason: "objective_exists" }) }));
    expect(readSavedObjectiveBrief(workspace, "eng-founders")!.content).toBe("## Outcome\nBook an evaluation.");

    writeSavedObjectiveBrief(workspace, { name: "eng-founders", text: "## Outcome\nNew.", overwrite: true });
    expect(readSavedObjectiveBrief(workspace, "eng-founders")!.content).toBe("## Outcome\nNew.");
  });

  it("refuses a symlinked objectives directory or brief file", () => {
    const outside = mkdtempSync(join(tmpdir(), "signals-objectives-outside-"));
    try {
      symlinkSync(outside, join(root, "objectives"));
      expect(() => writeSavedObjectiveBrief(workspace, { name: "eng", text: "x" }))
        .toThrow(expect.objectContaining({ details: expect.objectContaining({ reason: "symlink" }) }));
      expect(() => listSavedObjectiveBriefs(workspace)).toThrow();
      rmSync(join(root, "objectives"));
      mkdirSync(join(root, "objectives"));
      writeFileSync(join(outside, "target.md"), "## Outcome\nOutside");
      symlinkSync(join(outside, "target.md"), join(root, "objectives", "linked.md"));
      expect(() => readSavedObjectiveBrief(workspace, "linked"))
        .toThrow(expect.objectContaining({ details: expect.objectContaining({ reason: "symlink" }) }));
      expect(() => writeSavedObjectiveBrief(workspace, { name: "linked", text: "x", overwrite: true }))
        .toThrow(expect.objectContaining({ details: expect.objectContaining({ reason: "symlink" }) }));
      expect(readFileSync(join(outside, "target.md"), "utf8")).toBe("## Outcome\nOutside");
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it("lists saved briefs with their outcome and skips unsafe or foreign files", () => {
    expect(listSavedObjectiveBriefs(workspace)).toEqual([]);
    writeSavedObjectiveBrief(workspace, { name: "first", text: "## Outcome\nOne." });
    writeSavedObjectiveBrief(workspace, { name: "second", text: "No outcome here." });
    writeFileSync(join(root, "objectives", "Not-A-Brief.md"), "ignored");
    writeFileSync(join(root, "objectives", "notes.txt"), "ignored");
    const listed = listSavedObjectiveBriefs(workspace);
    expect(listed.map((brief) => brief.name).sort()).toEqual(["first", "second"]);
    expect(listed.find((brief) => brief.name === "first")).toMatchObject({ outcome: "One.", path: "objectives/first.md" });
    expect(listed.find((brief) => brief.name === "second")?.outcome).toBeNull();
  });
});
