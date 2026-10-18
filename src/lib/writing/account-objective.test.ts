import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AgentToolError } from "@/lib/agent-tools/types";
import type { PersonalityWorkspace } from "@/lib/personality/workspace";
import {
  ACCOUNT_OBJECTIVE_KINDS,
  ACCOUNT_OBJECTIVE_LIMITATIONS,
  accountObjectiveSchema,
  computeAccountObjectiveHash,
  listObjectiveMentionTargets,
  normalizeAccountObjective,
  previewObjectiveBrief,
  type AccountObjective,
} from "@/lib/writing/account-objective";
import { COMMERCIAL_BRIEF, PRODUCTS_FIXTURE } from "@/test/account-objective-fixture";

let root = "";
let workspace: PersonalityWorkspace;
const resolveWorkspace = async () => workspace;
const unavailable = async (): Promise<PersonalityWorkspace> => {
  throw new AgentToolError("WORKSPACE_UNAVAILABLE", "no workspace");
};

function commercial(text: string) {
  return { kind: "commercial", brief: { kind: "inline", text } };
}

async function normalized(raw: unknown, options: { source?: "run_config" | "template_config"; resolve?: () => Promise<PersonalityWorkspace> } = {}) {
  const result = await normalizeAccountObjective({
    raw,
    source: options.source ?? "run_config",
    resolveWorkspace: options.resolve ?? resolveWorkspace,
    now: 1_800_000_000,
  });
  if (!result.ok) throw new Error(`${result.reason}: ${result.message}`);
  return result.objective;
}

async function refusal(raw: unknown, resolve: () => Promise<PersonalityWorkspace> = resolveWorkspace) {
  const result = await normalizeAccountObjective({ raw, source: "run_config", resolveWorkspace: resolve });
  if (result.ok) throw new Error("expected a refusal");
  return result;
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "signals-account-objective-"));
  workspace = { slug: "signals", id: "workspace-test", dir: root, key: "test" };
  writeFileSync(join(root, "PRODUCTS.md"), PRODUCTS_FIXTURE);
  writeFileSync(join(root, "BRAND.md"), "# Brand\nPlain, specific, no hype.\n");
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("account objective contract", () => {
  it("pins the objective kinds and limitation codes", () => {
    // Adding a kind or a limitation changes what the brief, cards and authority mean: ADR first.
    expect(ACCOUNT_OBJECTIVE_KINDS).toEqual(["commercial", "relationship_only"]);
    expect(ACCOUNT_OBJECTIVE_LIMITATIONS).toEqual([
      "offering_missing",
      "offering_unresolved",
      "offering_ambiguous",
      "offering_proof_missing",
      "mention_unresolved",
      "fit_missing",
      "success_missing",
    ]);
  });

  it("stamps relationship-only by default when no objective was given, without inferring one", async () => {
    const objective = await normalized(undefined);
    expect(objective).toMatchObject({
      schemaVersion: 2,
      kind: "relationship_only",
      source: "default",
      brief: null,
      parsed: null,
      mentions: [],
      offering: null,
      limitations: [],
    });
    expect(objective.objectiveId).toMatch(/^aobj_/);
    expect(objective.hash).toBe(computeAccountObjectiveHash(objective));
  });

  it("records the provenance it was given for an explicit objective", async () => {
    expect((await normalized({ kind: "relationship_only" }, { source: "template_config" })).source).toBe("template_config");
    expect((await normalized({ kind: "relationship_only" })).source).toBe("run_config");
  });

  it("snapshots an inline commercial brief with its offering and mentions", async () => {
    const objective = await normalized(commercial(COMMERCIAL_BRIEF));
    expect(objective).toMatchObject({
      kind: "commercial",
      source: "run_config",
      brief: { source: { kind: "inline" }, text: COMMERCIAL_BRIEF },
      parsed: {
        outcome: "Agree to a 20-minute evaluation of @PRODUCTS.md#engineering-workflow.",
        fit: "Technical founder hiring engineers.",
        unknowns: ["Whether they use a coding agent today"],
        nextStep: "Ask which workflow they use for new hires.",
        success: "A reply naming their current workflow.",
      },
      offering: {
        slug: "engineering-workflow",
        name: "Engineering Workflow (Agent Runtime)",
        proofPointCount: 2,
        mentionIndex: 0,
      },
      limitations: [],
    });
    expect(objective.mentions.map((mention) => [mention.raw, Boolean(mention.resolved)])).toEqual([
      ["@PRODUCTS.md#engineering-workflow", true],
      ["@BRAND.md", true],
    ]);
    expect(objective.mentions[0].resolved!.excerpt).toContain("Engineering Workflow");
    expect(objective.mentions[0].resolved!.excerpt).not.toContain("Bare Offering");
    expect(objective.mentions[1].resolved!.excerpt).toContain("no hype");
    expect(accountObjectiveSchema.safeParse(objective).success).toBe(true);
  });

  it("computes each limitation from facts the server can check", async () => {
    const limitationsOf = async (text: string) => (await normalized(commercial(text))).limitations;
    expect(await limitationsOf("## Outcome\nBook a call.")).toEqual(["offering_missing", "fit_missing", "success_missing"]);
    expect(await limitationsOf("## Outcome\nBook a call about @PRODUCTS.md.\n## Fit\nx\n## Success\ny"))
      .toEqual(["offering_missing"]);
    expect(await limitationsOf("## Outcome\nTry @PRODUCTS.md#nope.\n## Fit\nx\n## Success\ny"))
      .toEqual(["offering_unresolved"]);
    expect(await limitationsOf("## Outcome\n@PRODUCTS.md#engineering-workflow or @PRODUCTS.md#bare-offering\n## Fit\nx\n## Success\ny"))
      .toEqual(["offering_ambiguous"]);
    expect(await limitationsOf("## Outcome\n@PRODUCTS.md#bare-offering\n## Fit\nx\n## Success\ny"))
      .toEqual(["offering_proof_missing"]);
    expect(await limitationsOf("## Outcome\n@PRODUCTS.md#engineering-workflow, see @SOUL.md and @BRAND.md#tone\n## Fit\nx\n## Success\ny"))
      .toEqual(["mention_unresolved"]);
  });

  it("names why a mention is unresolved", async () => {
    rmSync(join(root, "PRODUCTS.md"));
    const objective = await normalized(commercial("## Outcome\n@PRODUCTS.md#engineering-workflow @SOUL.md @BRAND.md#tone"));
    expect(objective.mentions.map((mention) => mention.unresolvedReason)).toEqual([
      "file_absent",
      "file_absent",
      "anchor_not_allowed",
    ]);
    expect(objective.limitations).toEqual(expect.arrayContaining(["offering_unresolved", "mention_unresolved"]));
  });

  it("treats an unsafe mentioned file as unresolved, never as a refusal", async () => {
    writeFileSync(join(root, "elsewhere.md"), "outside");
    symlinkSync(join(root, "elsewhere.md"), join(root, "SOUL.md"));
    const objective = await normalized(commercial("## Outcome\nBook a call. @SOUL.md"));
    expect(objective.mentions[0]).toMatchObject({ resolved: null, unresolvedReason: "file_unsafe" });
  });

  it("snapshots a saved brief by path and file hash", async () => {
    mkdirSync(join(root, "objectives"));
    writeFileSync(join(root, "objectives", "eng-founders.md"), COMMERCIAL_BRIEF);
    const objective = await normalized({ kind: "commercial", brief: { kind: "saved", path: "objectives/eng-founders.md" } });
    expect(objective.brief).toMatchObject({
      source: { kind: "saved", path: "objectives/eng-founders.md", fileHash: expect.stringMatching(/^[0-9a-f]{64}$/) },
      text: COMMERCIAL_BRIEF,
    });
  });

  it("keeps sourceHash stable for the same sources and changes it when a source changes", async () => {
    const first = await normalized(commercial(COMMERCIAL_BRIEF));
    const second = await normalized(commercial(COMMERCIAL_BRIEF));
    expect(second.sourceHash).toBe(first.sourceHash);
    expect(second.objectiveId).not.toBe(first.objectiveId);
    // Another product's entry changing does not move this run's offering source.
    writeFileSync(join(root, "PRODUCTS.md"), PRODUCTS_FIXTURE.replace("## 2. Bare Offering", "## 2. Bare Offering Renamed"));
    expect((await normalized(commercial(COMMERCIAL_BRIEF))).sourceHash).toBe(first.sourceHash);
    writeFileSync(join(root, "BRAND.md"), "# Brand\nChanged.\n");
    expect((await normalized(commercial(COMMERCIAL_BRIEF))).sourceHash).not.toBe(first.sourceHash);
  });

  it("refuses with a typed reason for each invalid input", async () => {
    expect((await refusal({ kind: "commercial" })).reason).toBe("invalid");
    expect((await refusal({ kind: "sales" })).reason).toBe("invalid");
    expect((await refusal({ kind: "relationship_only", brief: { kind: "inline", text: "x" } })).reason).toBe("invalid");
    expect((await refusal(commercial("## Fit\nNo outcome."))).reason).toBe("outcome_missing");
    expect((await refusal(commercial(`## Outcome\n${"x".repeat(16_385)}`))).reason).toBe("too_large");
    expect((await refusal({ kind: "commercial", brief: { kind: "saved", path: "objectives/missing.md" } })).reason)
      .toBe("saved_brief_not_found");
    expect((await refusal({ kind: "commercial", brief: { kind: "saved", path: "BRAND.md" } })).reason)
      .toBe("saved_brief_unsafe");
    expect((await refusal({ kind: "commercial", brief: { kind: "saved", path: "objectives/../BRAND.md" } })).reason)
      .toBe("saved_brief_unsafe");
  });

  it("refuses a saved brief or mentions when the workspace is unavailable, but not an inline brief alone", async () => {
    expect((await refusal({ kind: "commercial", brief: { kind: "saved", path: "objectives/eng.md" } }, unavailable)).reason)
      .toBe("workspace_unavailable");
    expect((await refusal(commercial(COMMERCIAL_BRIEF), unavailable)).reason).toBe("workspace_unavailable");
    const alone = await normalized(commercial("## Outcome\nBook a call."), { resolve: unavailable });
    expect(alone.limitations).toContain("offering_missing");
  });

  it("re-normalizes a stored record as input and never trusts its server fields", async () => {
    const original = await normalized(commercial(COMMERCIAL_BRIEF));
    const forged: AccountObjective = {
      ...original,
      limitations: [],
      offering: { ...original.offering!, name: "Forged" },
      hash: "forged",
    };
    const again = await normalized(forged);
    expect(again.offering?.name).toBe("Engineering Workflow (Agent Runtime)");
    expect(again.objectiveId).not.toBe(original.objectiveId);
    expect(again.hash).toBe(computeAccountObjectiveHash(again));
    expect(again.brief?.text).toBe(COMMERCIAL_BRIEF);
  });
});

describe("objective brief preview and mention targets", () => {
  it("previews without refusing a missing outcome", async () => {
    const preview = await previewObjectiveBrief({ text: "## Fit\nx\nSee @PRODUCTS.md#engineering-workflow", resolveWorkspace });
    expect(preview.parsed.outcome).toBeNull();
    expect(preview.offering?.slug).toBe("engineering-workflow");
    expect(preview.workspace).toBe("available");
  });

  it("reports the workspace as unavailable and leaves mentions unresolved", async () => {
    const preview = await previewObjectiveBrief({ text: "## Outcome\nx @BRAND.md", resolveWorkspace: unavailable });
    expect(preview.workspace).toBe("unavailable");
    expect(preview.mentions[0]).toMatchObject({ resolved: null, unresolvedReason: "workspace_unavailable" });
  });

  it("lists PRODUCTS.md entries and the allowlisted files that exist", () => {
    expect(listObjectiveMentionTargets(workspace)).toEqual({
      products: [
        expect.objectContaining({ slug: "engineering-workflow", proofPointCount: 2, token: "@PRODUCTS.md#engineering-workflow" }),
        expect.objectContaining({ slug: "bare-offering", proofPointCount: 0, token: "@PRODUCTS.md#bare-offering" }),
      ],
      files: [{ path: "BRAND.md", token: "@BRAND.md" }, { path: "PRODUCTS.md", token: "@PRODUCTS.md" }],
      productsFile: "present",
    });
    rmSync(join(root, "PRODUCTS.md"));
    expect(listObjectiveMentionTargets(workspace)).toMatchObject({ products: [], productsFile: "absent" });
  });
});
