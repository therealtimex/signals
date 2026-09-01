import { copyFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createContact } from "@/lib/db/queries/contacts";
import { proposePersonalityProjection } from "@/lib/personality/proposal";
import { PERSONALITY_INDEX_TEXT } from "@/lib/personality/render";
import { resetPersonalityStore } from "@/lib/personality/store-paths";
import { resetCoreTables } from "@/test/db";
import {
  personalityGuardDependencies,
  personalityWorkspace,
} from "@/test/personality-writing-fixture";

let storageDir = "";

describe.sequential("Signals workspace static Personality pointer", () => {
  beforeEach(() => {
    resetCoreTables();
    resetPersonalityStore();
    storageDir = mkdtempSync(join(tmpdir(), "signals-380-template-pointer-"));
  });

  afterEach(() => {
    rmSync(storageDir, { recursive: true, force: true });
  });

  it("keeps the renderer pointer verbatim and suppresses a dynamic AGENTS block", async () => {
    const templatePath = join(process.cwd(), "realtimex-plugin/templates/signals/AGENTS.md");
    const template = readFileSync(templatePath, "utf8");
    expect(template).toContain(PERSONALITY_INDEX_TEXT);
    expect(template).not.toContain("signals:personality");

    const workspace = personalityWorkspace(storageDir);
    copyFileSync(templatePath, join(workspace.dir, "AGENTS.md"));
    createContact({ name: "Template pointer writer", isSelf: true });
    const proposal = await proposePersonalityProjection(
      {},
      personalityGuardDependencies(workspace),
    );

    expect(proposal.files.some((file) => file.path === "AGENTS.md")).toBe(false);
  });
});
