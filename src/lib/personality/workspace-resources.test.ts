import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PersonalityWorkspace } from "@/lib/personality/workspace";
import {
  WORKSPACE_RESOURCE_MAX_BYTES,
  parseProductsCatalog,
  readWorkspaceResource,
} from "@/lib/personality/workspace-resources";
import { PRODUCTS_FIXTURE, bigProductsFixture } from "@/test/account-objective-fixture";


let root = "";
let workspace: PersonalityWorkspace;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "signals-workspace-resources-"));
  workspace = { slug: "signals", id: "workspace-test", dir: root, key: "test" };
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("PRODUCTS.md entries", () => {
  it("extracts entries by slug with name, one-liner, proof count and the section excerpt", () => {
    const entries = parseProductsCatalog(PRODUCTS_FIXTURE);
    expect(entries.map((entry) => entry.slug)).toEqual(["engineering-workflow", "bare-offering"]);
    expect(entries[0]).toMatchObject({
      name: "Engineering Workflow (Agent Runtime)",
      oneLiner: "Agents that ship reviewable code in your own workspace.",
      proofPointCount: 2,
    });
    expect(entries[0].excerpt.startsWith("## 1. Engineering Workflow")).toBe(true);
    expect(entries[0].excerpt).toContain("Real tools");
    expect(entries[0].excerpt).not.toContain("Bare Offering");
    expect(entries[0].excerpt.endsWith("---")).toBe(false);
    expect(entries[1]).toMatchObject({ name: "Bare Offering", oneLiner: null, proofPointCount: 0 });
  });

  it("hashes the whole entry section, not the bounded excerpt (Review #549 F1)", () => {
    const before = parseProductsCatalog(bigProductsFixture()).find((entry) => entry.slug === "big-offering")!;
    const after = parseProductsCatalog(bigProductsFixture(["- **Proven:** A replaced proof point.", "- **Also:** Another."]))
      .find((entry) => entry.slug === "big-offering")!;
    expect(before.excerpt.length).toBe(8 * 1024);
    expect(before.excerpt).not.toContain("Proven");
    expect(after.excerpt).toBe(before.excerpt);
    expect(after.proofPointCount).toBe(2);
    expect(after.sectionHash).not.toBe(before.sectionHash);
    // Another entry's hash is untouched by this one's edit.
    const other = (fixture: string) => parseProductsCatalog(fixture).find((entry) => entry.slug === "engineering-workflow")!.sectionHash;
    expect(other(bigProductsFixture(["- changed"]))).toBe(other(bigProductsFixture()));
  });

  it("references an entry by slug, not by heading text, and keeps the first duplicate", () => {
    const entries = parseProductsCatalog([
      "## Renamed heading",
      "- **Slug:** `engineering-workflow`",
      "## Duplicate",
      "- **Slug:** `engineering-workflow`",
      "## Bad slug",
      "- **Slug:** `Not_A_Slug`",
    ].join("\n"));
    expect(entries).toHaveLength(1);
    expect(entries[0].name).toBe("Renamed heading");
  });
});

describe("readWorkspaceResource", () => {
  it("reads an allowlisted file with its hash and returns null when absent", () => {
    writeFileSync(join(root, "PRODUCTS.md"), PRODUCTS_FIXTURE);
    const file = readWorkspaceResource(workspace, "PRODUCTS.md");
    expect(file).toMatchObject({ path: "PRODUCTS.md", content: PRODUCTS_FIXTURE });
    expect(file!.fileHash).toMatch(/^[0-9a-f]{64}$/);
    expect(readWorkspaceResource(workspace, "BRAND.md")).toBeNull();
  });

  it("refuses symlinks, case-fold aliases, non-UTF-8 content and files over 256 KiB", () => {
    writeFileSync(join(root, "elsewhere.md"), "outside");
    symlinkSync(join(root, "elsewhere.md"), join(root, "BRAND.md"));
    expect(() => readWorkspaceResource(workspace, "BRAND.md")).toThrow(expect.objectContaining({ details: expect.objectContaining({ reason: "symlink" }) }));

    rmSync(join(root, "BRAND.md"));
    writeFileSync(join(root, "soul.md"), "alias");
    expect(() => readWorkspaceResource(workspace, "SOUL.md")).toThrow(expect.objectContaining({ details: expect.objectContaining({ reason: "case_fold_alias" }) }));

    rmSync(join(root, "soul.md"));
    writeFileSync(join(root, "VOICE.md"), Buffer.from([0xff, 0xfe, 0xfd]));
    expect(() => readWorkspaceResource(workspace, "VOICE.md")).toThrow(expect.objectContaining({ details: expect.objectContaining({ reason: "file_not_utf8" }) }));

    writeFileSync(join(root, "PRODUCTS.md"), "x".repeat(WORKSPACE_RESOURCE_MAX_BYTES + 1));
    expect(() => readWorkspaceResource(workspace, "PRODUCTS.md")).toThrow(expect.objectContaining({ details: expect.objectContaining({ reason: "file_too_large" }) }));
  });

  it("refuses a path that is not on the allowlist", () => {
    expect(() => readWorkspaceResource(workspace, "AGENTS.md" as never)).toThrow(expect.objectContaining({ details: expect.objectContaining({ reason: "not_allowlisted" }) }));
  });
});
