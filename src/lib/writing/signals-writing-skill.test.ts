import { beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { db } from "@/lib/db/client";
import { browserConnections, contentItems, platformTargets, variants } from "@/lib/db/schema";
import { getLaunchById } from "@/lib/db/queries/launches";
import { invokeAgentTool } from "@/lib/agent-tools/invoke";
import { AGENT_TOOLS } from "@/lib/agent-tools/registry";
import { approveVoiceProfileSchema, materializeVariantSchema } from "@/lib/agent-tools/writing-handlers";
import { sendToAgentSchema } from "@/app/api/content/send-to-agent/route";
import { deriveAuditVerdict, validateAuditFindingSemantics } from "@/lib/writing/audit";
import { buildWritingUnits, deriveWritingPublishText } from "@/lib/writing/content-writing";
import {
  evidenceSpineSchema,
  launchWritingPatchSchema,
  variantGenerationSchema,
  variantWritingInputSchema,
  voiceProfileInputSchema,
  writingAuditInputSchema,
} from "@/lib/writing/contracts";
import { deriveHard, hardLimit } from "@/lib/writing/variant-writing";
import { WRITING_SURFACE_CAPABILITIES } from "@/lib/writing/capabilities";
import { parseFormulaId, parseRuleId } from "@/lib/writing/ids";
import { SURFACE_IDS } from "@/lib/writing/surfaces";
import { resetCoreTables } from "@/test/db";
import { extractTaggedBlocks, FORMULA_ID_RE, parseFrontmatter, RULE_ID_RE } from "../../../scripts/lib/signals-writing-skill-format.mjs";

type Helper = {
  hardLimit(surface: string): number;
  measure(surface: string, input: { texts: string[]; media?: { assetIds: string[] } }): { units: { texts: string[]; count: number; chars: number[] }; hard: ReturnType<typeof deriveHard>; violations: { reason: string }[] };
  deriveVerdict(audit: Record<string, unknown>, spine: Record<string, unknown>): string;
  precheck(variant: Record<string, unknown>, spine: Record<string, unknown>, launch?: Record<string, unknown>): { ok: boolean; problems: { reason: string }[] };
};

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const skillDir = path.join(root, ".claude/skills/signals-writing");
const fixtureDir = path.join(root, "test/fixtures/signals-writing");
const helper = createRequire(import.meta.url)(path.join(skillDir, "scripts/writing-cli.cjs")) as Helper;
const json = <T = Record<string, unknown>>(name: string): T => JSON.parse(fs.readFileSync(path.join(fixtureDir, name), "utf8")) as T;
const example = (name: string) => extractTaggedBlocks(fs.readFileSync(path.join(skillDir, "reference.md"), "utf8"), `signals-writing:example:${name}`, "reference.md")[0];

type VariantFixture = { platform: "x" | "linkedin" | "facebook"; surface: "x/post" | "x/thread" | "linkedin/post" | "facebook/post"; targetId: string; formulaId: string; texts: string[] };
type VariantDerivation = { mode: "revise" | "humanize" | "adapt"; requestHash: string; derivedFromVariantId: string };

function variantInput(fixture: VariantFixture, spine = json("spine.json"), derivation?: VariantDerivation) {
  const units = buildWritingUnits(fixture.texts);
  const hard = helper.measure(fixture.surface, { texts: fixture.texts }).hard;
  return {
    launchId: (spine as { launchId: string }).launchId,
    body: fixture.texts[0],
    generationMetadata: {
      schemaVersion: 1, kind: "signals-writing", mode: derivation?.mode ?? "draft", model: "fixture-model",
      skill: { name: "signals-writing", version: "1.0.0" },
      agent: { workflowRunId: "run_fixture" },
      requestHash: derivation?.requestHash ?? `wr1:run_fixture:${fixture.surface}:draft:1`, generatedAt: 1_750_000_001,
    },
    metadata: { writing: {
      schemaVersion: 1, platform: fixture.platform, surface: fixture.surface, targetId: fixture.targetId,
      goal: "awareness", formulaId: fixture.formulaId, overlay: { id: `overlay:${fixture.platform}`, version: 1 },
      core: { version: 1 }, voiceProfile: null, voicePrecedence: "voice_first",
      spine: { id: (spine as { id: string }).id, hash: (spine as { hash: string }).hash }, units,
      claimMap: [{ claimId: "clm_fixture01", present: true, unit: 0, verbatim: false }],
      lineage: {
        sourceIds: ["src_fixture01"],
        ...(derivation ? { derivedFromVariantId: derivation.derivedFromVariantId } : {}),
      },
      audit: {
        schemaVersion: 1, auditedAt: 1_750_000_001,
        auditor: { kind: "agent", skillVersion: "1.0.0", workflowRunId: "run_fixture" },
        overlay: { id: `overlay:${fixture.platform}`, version: 1 }, core: { version: 1 }, verdict: "pass", findings: [],
        claims: { total: 1, preserved: 1, altered: [], missing: [], invented: [], privateIncluded: [] }, hard,
        voice: { status: "none", skipped: [] }, heuristics: { applied: [], conflicts: [], skippedForVoice: [] },
      },
    } },
  };
}

describe("signals-writing skill package", () => {
  it("passes the standalone skill validator", () => {
    expect(execFileSync(process.execPath, [path.join(root, "scripts/verify-signals-writing-skill.mjs")], { encoding: "utf8" })).toContain("validation: OK");
  });

  it("parses namespaced overlay records and the complete formula catalog", () => {
    const expected = { x: 10, linkedin: 19, facebook: 9 };
    const overlaySurfaces = new Set<string>();
    for (const [platform, formulaCount] of Object.entries(expected)) {
      const text = fs.readFileSync(path.join(skillDir, `overlays/${platform}.md`), "utf8");
      const { data } = parseFrontmatter(text, `${platform}.md`);
      const frontmatter = data as { overlayId: string; version: number; platform: string; surfaces: string[] };
      expect(frontmatter).toMatchObject({ overlayId: `overlay:${platform}`, version: 1, platform });
      const rules = extractTaggedBlocks(text, "signals-writing:rules", `${platform}.md`).flat() as { id: string }[];
      const formulas = extractTaggedBlocks(text, "signals-writing:formulas", `${platform}.md`).flat() as { id: string }[];
      expect(rules.every((record) => RULE_ID_RE.test(record.id))).toBe(true);
      expect(rules.every((record) => parseRuleId(record.id) !== null)).toBe(true);
      expect(formulas).toHaveLength(formulaCount);
      expect(formulas.every((record) => FORMULA_ID_RE.test(record.id))).toBe(true);
      expect(formulas.every((record) => parseFormulaId(record.id) !== null)).toBe(true);
      for (const surface of frontmatter.surfaces) {
        overlaySurfaces.add(surface);
        expect(SURFACE_IDS).toContain(surface);
        expect(WRITING_SURFACE_CAPABILITIES[surface as keyof typeof WRITING_SURFACE_CAPABILITIES].draft).toBe("supported");
      }
    }
    expect([...overlaySurfaces].sort()).toEqual(Object.entries(WRITING_SURFACE_CAPABILITIES).filter(([, capability]) => capability.draft === "supported").map(([surface]) => surface).sort());
  });

  it("keeps every reference example aligned with a real input schema", () => {
    expect(launchWritingPatchSchema.safeParse(example("launch-writing-patch")).success).toBe(true);
    expect(evidenceSpineSchema.safeParse(example("spine")).success).toBe(true);
    expect(variantWritingInputSchema.safeParse(example("variant-input")).success).toBe(true);
    expect(variantGenerationSchema.safeParse(example("generation")).success).toBe(true);
    expect(writingAuditInputSchema.safeParse(example("audit-input")).success).toBe(true);
    expect(voiceProfileInputSchema.safeParse(example("voice-profile-input")).success).toBe(true);
    expect(materializeVariantSchema.safeParse(example("materialize-input")).success).toBe(true);
    expect(approveVoiceProfileSchema.safeParse(example("approve-voice-input")).success).toBe(true);
    expect(sendToAgentSchema.safeParse(example("send-to-agent-body")).success).toBe(true);
  });

  it("names only registered agent tools in operational prose", () => {
    const markdownFiles = [
      "SKILL.md", "reference.md",
      "core/claims.md", "core/voice.md", "core/audit.md", "core/adapt.md", "core/approval.md", "core/lineage.md",
      "overlays/README.md", "overlays/x.md", "overlays/linkedin.md", "overlays/facebook.md",
    ];
    const nonToolTokens = new Set([
      "adapted_from", "auto_low_risk", "content_item", "derived_from", "materialized_as", "pinned_superseded",
      "published_as", "rules_first", "sourced_from", "variant_locked", "voice_first",
    ]);
    const mentioned = new Set<string>();
    const unsupported: string[] = [];
    for (const relative of markdownFiles) {
      const text = fs.readFileSync(path.join(skillDir, relative), "utf8");
      const operational = relative === "SKILL.md"
        ? text.replace(/## Never do[\s\S]*?(?=\n## |$)/, "")
        : text;
      for (const match of operational.matchAll(/`([a-z][a-z0-9]*(?:_[a-z0-9]+)+)`/g)) {
        const token = match[1];
        mentioned.add(token);
        if (!AGENT_TOOLS[token] && !nonToolTokens.has(token)) unsupported.push(`${relative}: ${token}`);
      }
    }
    expect(mentioned).toContain("query_graph");
    expect(AGENT_TOOLS.query_graph).toBeDefined();
    expect(unsupported).toEqual([]);
  });

  it("matches server hard limits, measurements, and audit verdicts", () => {
    for (const surface of ["x/post", "x/thread", "linkedin/post", "facebook/post"]) expect(helper.hardLimit(surface)).toBe(hardLimit(surface));
    const measurement = json<{ surface: string; texts: string[]; media: { assetIds: string[] }; expected: Record<string, unknown> }>("units-measure.json");
    const measured = helper.measure(measurement.surface, measurement);
    expect(measured.hard).toMatchObject(measurement.expected);
    expect(measured.hard).toEqual(deriveHard({ units: measured.units, media: measurement.media, limit: hardLimit(measurement.surface) }));

    const spine = json<Record<string, unknown>>("spine.json");
    const cases = [
      ["audit-voice-first-skipped.json", spine, "pass"],
      ["audit-rules-first.json", spine, "warn"],
      ["audit-blocked-invented.json", spine, "block"],
      ["audit-altered-verbatim.json", { ...spine, claims: [{ ...(spine.claims as Record<string, unknown>[])[0], verbatimRequired: true }] }, "block"],
    ] as const;
    for (const [name, currentSpine, verdict] of cases) {
      const audit = json<Record<string, unknown>>(name);
      expect(helper.deriveVerdict(audit, currentSpine)).toBe(verdict);
      expect(deriveAuditVerdict(audit as never, currentSpine as never)).toBe(verdict);
      expect(validateAuditFindingSemantics(audit as never)).toBeNull();
    }
  });

  it("prechecks the same cross-document mutations the server rejects", () => {
    const spine = json<Record<string, unknown>>("spine.json");
    const launch = json<Record<string, unknown>>("launch-writing.json");
    const fixtureNames = ["x-post.variant.json", "x-thread.variant.json", "linkedin-post.variant.json", "facebook-post.variant.json"];
    for (const name of fixtureNames) expect(helper.precheck(variantInput(json<VariantFixture>(name)), spine, launch)).toEqual({ ok: true, problems: [] });
    const payload = variantInput(json<VariantFixture>(fixtureNames[0]));
    const wrongBody = structuredClone(payload) as ReturnType<typeof variantInput>;
    wrongBody.body = "Different body";
    expect(helper.precheck(wrongBody, spine, launch).problems.map((problem) => problem.reason)).toContain("body_units_mismatch");
    const wrongVoice = structuredClone(payload) as ReturnType<typeof variantInput>;
    wrongVoice.metadata.writing.audit.voice.status = "rules_first";
    expect(helper.precheck(wrongVoice, spine, launch).problems.map((problem) => problem.reason)).toContain("audit_voice_mismatch");
    const stale = structuredClone(payload) as ReturnType<typeof variantInput>;
    stale.metadata.writing.spine.hash = "stale";
    expect(helper.precheck(stale, spine, launch).problems.map((problem) => problem.reason)).toContain("spine_mismatch");
    const inventedClaim = structuredClone(payload) as ReturnType<typeof variantInput>;
    inventedClaim.metadata.writing.claimMap[0].claimId = "clm_unknown01";
    expect(helper.precheck(inventedClaim, spine, launch).problems.map((problem) => problem.reason)).toContain("claim_unknown");
  });
});

describe("signals-writing fixture integration", () => {
  beforeEach(() => {
    resetCoreTables();
    db.insert(browserConnections).values({ id: "connection_fixture", sessionName: "writing-skill", kind: "dedicated", status: "active" }).run();
    for (const [id, platform] of [["target_x_fixture", "x"], ["target_linkedin_fixture", "linkedin"], ["target_facebook_fixture", "facebook"]] as const) {
      db.insert(platformTargets).values({ id, connectionId: "connection_fixture", platform, kind: "profile", name: `${platform} fixture`, capabilities: "[]", status: "active" }).run();
    }
  });

  it("persists distinct surface variants on one spine and materializes thread order", async () => {
    const launchWriting = json<Record<string, unknown>>("launch-writing.json");
    const launch = await invokeAgentTool("upsert_launch", { name: "Skill fixture", metadata: { writing: launchWriting } }) as { id: string };
    const storedLaunch = getLaunchById(launch.id)!;
    const spine = (JSON.parse(storedLaunch.metadata ?? "{}").writing.spine) as Record<string, unknown>;
    const fixtures = ["x-post.variant.json", "x-thread.variant.json", "linkedin-post.variant.json", "facebook-post.variant.json"].map((name) => json<VariantFixture>(name));
    const persisted: { id: string }[] = [];
    for (const fixture of fixtures) {
      const input = variantInput(fixture, spine);
      input.launchId = launch.id;
      persisted.push(await invokeAgentTool("upsert_variant", input) as { id: string });
    }
    const rows = db.select().from(variants).all().filter((row) => persisted.some((variant) => variant.id === row.id));
    expect(rows.map((row) => JSON.parse(row.metadata ?? "{}").writing.surface).sort()).toEqual(fixtures.map((fixture) => fixture.surface).sort());
    expect(new Set(rows.map((variant) => variant.body)).size).toBe(4);
    expect(rows.map((variant) => JSON.parse(variant.metadata ?? "{}").writing.spine.hash)).toEqual(Array(4).fill(spine.hash));
    for (const [index, left] of rows.entries()) for (const right of rows.slice(index + 1)) {
      expect(left.body?.startsWith(right.body ?? "") || right.body?.startsWith(left.body ?? "")).toBe(false);
      expect(left.body?.endsWith(right.body ?? "") || right.body?.endsWith(left.body ?? "")).toBe(false);
      const leftLines = new Set((left.body ?? "").split("\n").filter(Boolean));
      const rightLines = (right.body ?? "").split("\n").filter(Boolean);
      expect(rightLines.filter((line) => leftLines.has(line)).length / Math.max(leftLines.size, rightLines.length)).toBeLessThanOrEqual(0.5);
    }
    expect(getLaunchById(launch.id)?.status).toBe("ready");

    const original = persisted[0];
    const alternativeInput = variantInput(
      { ...fixtures[0], texts: ["A second angle: Aster moved review time from 10 minutes to 6 minutes."] },
      spine,
      { mode: "revise", requestHash: "wr1:run_fixture:x/post:revise:2", derivedFromVariantId: original.id },
    );
    alternativeInput.launchId = launch.id;
    expect(alternativeInput).not.toHaveProperty("id");
    const alternative = await invokeAgentTool("upsert_variant", alternativeInput) as {
      id: string;
      created: boolean;
      lineageEdges: { edgeType: string; srcType: string; srcId: string; dstType: string; dstId: string }[];
    };
    expect(alternative).toMatchObject({ created: true });
    expect(alternative.id).not.toBe(original.id);
    expect(alternative.lineageEdges).toEqual([{
      edgeType: "derived_from", srcType: "variant", srcId: alternative.id,
      dstType: "variant", dstId: original.id,
    }]);

    const thread = persisted[1];
    const materialized = await invokeAgentTool("materialize_variant", { variantId: thread.id }) as { contentItemId: string; created: boolean };
    const item = db.select().from(contentItems).all().find((row) => row.id === materialized.contentItemId)!;
    const units = JSON.parse(item.platformData ?? "{}").writing.units;
    expect(item.body).toBe(fixtures[1].texts[0]);
    expect(units.texts).toEqual(fixtures[1].texts);
    expect(deriveWritingPublishText(JSON.parse(item.platformData ?? "{}").writing, item)).toEqual({ text: fixtures[1].texts[0], threadTexts: fixtures[1].texts.slice(1) });

    const badBody = variantInput(fixtures[0], spine);
    badBody.launchId = launch.id;
    badBody.body = "Different body";
    badBody.generationMetadata.requestHash += ":bad-body";
    await expect(invokeAgentTool("upsert_variant", badBody)).rejects.toMatchObject({ details: { reason: "body_units_mismatch" } });
    const badVoice = variantInput(fixtures[0], spine);
    badVoice.launchId = launch.id;
    badVoice.metadata.writing.audit.voice.status = "rules_first";
    badVoice.generationMetadata.requestHash += ":bad-voice";
    await expect(invokeAgentTool("upsert_variant", badVoice)).rejects.toMatchObject({ details: { reason: "audit_voice_mismatch" } });
  });
});
