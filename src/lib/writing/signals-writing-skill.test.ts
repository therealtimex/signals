import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { db } from "@/lib/db/client";
import { browserConnections, contentItems, platformTargets, variants } from "@/lib/db/schema";
import { createContact } from "@/lib/db/queries/contacts";
import { getLaunchById } from "@/lib/db/queries/launches";
import { invokeAgentTool } from "@/lib/agent-tools/invoke";
import { handleGetWritingContext } from "@/lib/agent-tools/content-item-handlers";
import { AGENT_TOOLS } from "@/lib/agent-tools/registry";
import { approvePersonalityProjectionSchema } from "@/lib/agent-tools/personality-handlers";
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
  type EvidenceSpine,
} from "@/lib/writing/contracts";
import { deriveHard, hardLimit } from "@/lib/writing/variant-writing";
import {
  isPersonalityAwareWritingSkillVersion,
  variantPersonalityInputSchema,
} from "@/lib/writing/personality-lineage";
import { upsertVariantUseCase } from "@/lib/writing/variant-use-cases";
import { withPersonalityWritingGuard } from "@/lib/writing/personality-guard";
import { materializeVariantWithRunner } from "@/lib/writing/materialize";
import { WRITING_SURFACE_CAPABILITIES } from "@/lib/writing/capabilities";
import { parseFormulaId, parseRuleId } from "@/lib/writing/ids";
import { SURFACE_IDS } from "@/lib/writing/surfaces";
import { resetPersonalityStore } from "@/lib/personality/store-paths";
import type { PersonalityBindingView } from "@/lib/personality/status";
import { setTargetRepresentation } from "@/lib/personality/use-cases";
import { resetCoreTables } from "@/test/db";
import {
  normalizeAccountObjective,
  type AccountObjective,
} from "@/lib/writing/account-objective";
import type { LaunchComposition } from "@/lib/writing/contracts";
import type { ObjectiveSourceStatus } from "@/lib/writing/objective-sources";
import { assertWritingIntentAuthority } from "@/lib/writing/writing-intent-authority";
import { writingIntentRecordSchema } from "@/lib/writing/writing-intent";
import {
  installPersonalityBinding,
  personalityGuardDependencies,
  personalityWorkspace,
} from "@/test/personality-writing-fixture";
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
type PersonalityOverride = { bindingId?: string; skillVersion: string };
type WritingContextView = Awaited<ReturnType<typeof handleGetWritingContext>>;
type WritingContextVariant = WritingContextView["variants"][number];
type VariantPersonality = NonNullable<WritingContextVariant["personality"]>;
type VariantCardReadModelFields = {
  "variants[].personality.bindingId": VariantPersonality["bindingId"];
  "variants[].personalityState": WritingContextVariant["personalityState"];
  "variants[].personality.identity.selfContactId": VariantPersonality["identity"]["selfContactId"];
  "variants[].personality.identity.representedOrgId": VariantPersonality["identity"]["representedOrgId"];
  "variants[].personality.target.represents.kind": NonNullable<VariantPersonality["target"]>["represents"]["kind"];
};
type BindingStatus = PersonalityBindingView["status"];
type Binding = NonNullable<BindingStatus["binding"]>;
type ContextTarget = WritingContextView["targets"][number];
type BindingCardReadModelFields = {
  "status.binding.id": Binding["id"];
  "status.status": BindingStatus["status"];
  "status.host.capability": BindingStatus["host"]["capability"];
  "status.workspace.slug": BindingStatus["workspace"]["slug"];
  "status.workspace.dir": BindingStatus["workspace"]["dir"];
  "status.binding.identity.selfContactId": Binding["identity"]["selfContactId"];
  "status.binding.identity.representedOrgId": Binding["identity"]["representedOrgId"];
  "status.binding.sourceHash": Binding["sourceHash"];
  "status.currentSourceHash": BindingStatus["currentSourceHash"];
  "targets[].represents.kind": NonNullable<ContextTarget["represents"]>["kind"];
  "targets[].compatible": ContextTarget["compatible"];
  "status.detail": BindingStatus["detail"];
};
type VariantIntent = NonNullable<WritingContextVariant["intent"]>;
type VariantAsk = NonNullable<VariantIntent["ask"]>;
type EvidencedPain = Extract<VariantAsk["customerPain"], { status: "evidenced" }>;
type AskedPain = Extract<VariantAsk["customerPain"], { status: "asked" }>;
type SpineClaim = EvidenceSpine["claims"][number];
type SavedBriefSource = Extract<NonNullable<AccountObjective["brief"]>["source"], { kind: "saved" }>;
/**
 * Objective card lines (#549). `O` abbreviates `launch.writing.composition.objective`, which the
 * context projects verbatim from the stamped `AccountObjective`; `launch.writing.objectiveSource`
 * is the `ObjectiveSourceStatus` from `observeObjectiveSources`.
 */
type ObjectiveCardReadModelFields = {
  "O.kind": AccountObjective["kind"];
  "O.source": AccountObjective["source"];
  "O.brief.source.kind": NonNullable<AccountObjective["brief"]>["source"]["kind"];
  "O.brief.source.path": SavedBriefSource["path"];
  "O.offering.name": NonNullable<AccountObjective["offering"]>["name"];
  "O.offering.slug": NonNullable<AccountObjective["offering"]>["slug"];
  "O.parsed.outcome": NonNullable<AccountObjective["parsed"]>["outcome"];
  "O.parsed.fit": NonNullable<AccountObjective["parsed"]>["fit"];
  "O.parsed.unknowns": NonNullable<AccountObjective["parsed"]>["unknowns"];
  "O.parsed.nextStep": NonNullable<AccountObjective["parsed"]>["nextStep"];
  "O.parsed.success": NonNullable<AccountObjective["parsed"]>["success"];
  "O.limitations": AccountObjective["limitations"];
  "variants[].intent.goal.writingGoal": VariantIntent["goal"]["writingGoal"];
  "variants[].intent.ask.relation": VariantAsk["relation"];
  "variants[].intent.ask.testsUncertainty": VariantAsk["testsUncertainty"];
  "variants[].intent.ask.deferReason": VariantAsk["deferReason"];
  "variants[].intent.ask.statement": VariantAsk["statement"];
  "variants[].intent.ask.customerPain.status": VariantAsk["customerPain"]["status"];
  "variants[].intent.ask.customerPain.text": AskedPain["text"];
  "variants[].intent.ask.customerPain.claimIds": EvidencedPain["claimIds"];
  // Evidenced pain renders the cited spine claim's text, never its id (contract v2 §4.2).
  "launch.writing.spine.claims[].id": SpineClaim["id"];
  "launch.writing.spine.claims[].text": SpineClaim["text"] | null;
  "launch.writing.spine.claims[].sensitivity": SpineClaim["sensitivity"];
  "launch.writing.objectiveSource.status": ObjectiveSourceStatus["status"];
  "launch.writing.objectiveSource.changedPaths": ObjectiveSourceStatus["changedPaths"];
  "variants[].revokedReason": WritingContextVariant["revokedReason"];
};
type ProposalEntry = PersonalityBindingView["proposals"][number];
type ProposalCardReadModelFields = {
  "proposals[].proposal.workspace.slug": ProposalEntry["proposal"]["workspace"]["slug"];
  "proposals[].proposal.workspace.id": ProposalEntry["proposal"]["workspace"]["id"];
  "proposals[].proposal.workspace.dir": ProposalEntry["proposal"]["workspace"]["dir"];
  "proposals[].proposal.workspace.key": ProposalEntry["proposal"]["workspace"]["key"];
  "proposals[].proposal.sourceSnapshot.self.revision": NonNullable<ProposalEntry["proposal"]["sourceSnapshot"]>["self"]["revision"];
  "proposals[].proposal.sourceSnapshot.org.revision": NonNullable<NonNullable<ProposalEntry["proposal"]["sourceSnapshot"]>["org"]>["revision"];
  "proposals[].proposal.sourceSnapshot.voice.id": NonNullable<NonNullable<ProposalEntry["proposal"]["sourceSnapshot"]>["voice"]>["id"];
  "proposals[].proposal.sourceSnapshot.voice.version": NonNullable<NonNullable<ProposalEntry["proposal"]["sourceSnapshot"]>["voice"]>["version"];
  "proposals[].proposal.sourceSnapshot.voice.hash": NonNullable<NonNullable<ProposalEntry["proposal"]["sourceSnapshot"]>["voice"]>["hash"];
  "proposals[].proposal.sourceSnapshot.voice.input.profile.label": NonNullable<NonNullable<ProposalEntry["proposal"]["sourceSnapshot"]>["voice"]>["input"]["profile"]["label"];
  "proposals[].proposal.sourceSnapshot.statements.hash": NonNullable<NonNullable<ProposalEntry["proposal"]["sourceSnapshot"]>["statements"]>["hash"];
  "proposals[].proposal.files[].diff": ProposalEntry["proposal"]["files"][number]["diff"];
  "proposals[].proposal.files[].driftDiff": ProposalEntry["proposal"]["files"][number]["driftDiff"];
  "proposals[].proposal.files[].unmanagedBytes": ProposalEntry["proposal"]["files"][number]["unmanagedBytes"];
  "proposals[].proposal.preflight.warnings": ProposalEntry["proposal"]["preflight"]["warnings"];
  "proposals[].actions.approvalBlockers": ProposalEntry["actions"]["approvalBlockers"];
  "proposals[].actions.canApprove": ProposalEntry["actions"]["canApprove"];
  "proposals[].actions.canReject": ProposalEntry["actions"]["canReject"];
  "proposals[].actions.canRetry": ProposalEntry["actions"]["canRetry"];
};

function variantInput(
  fixture: VariantFixture,
  spine = json("spine.json"),
  derivation?: VariantDerivation,
  personality?: PersonalityOverride,
) {
  const units = buildWritingUnits(fixture.texts);
  const hard = helper.measure(fixture.surface, { texts: fixture.texts }).hard;
  const skillVersion = personality?.skillVersion ?? "1.0.0";
  return {
    launchId: (spine as { launchId: string }).launchId,
    body: fixture.texts[0],
    generationMetadata: {
      schemaVersion: 1, kind: "signals-writing", mode: derivation?.mode ?? "draft", model: "fixture-model",
      skill: { name: "signals-writing", version: skillVersion },
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
        auditor: { kind: "agent", skillVersion, workflowRunId: "run_fixture" },
        overlay: { id: `overlay:${fixture.platform}`, version: 1 }, core: { version: 1 }, verdict: "pass", findings: [],
        claims: { total: 1, preserved: 1, altered: [], missing: [], invented: [], privateIncluded: [] }, hard,
        voice: { status: "none", skipped: [] }, heuristics: { applied: [], conflicts: [], skippedForVoice: [] },
      },
      ...(personality?.bindingId
        ? { personality: { bindingId: personality.bindingId } }
        : {}),
    } },
  };
}

describe("signals-writing skill package", () => {
  it("passes the standalone skill validator", () => {
    expect(execFileSync(process.execPath, [path.join(root, "scripts/verify-signals-writing-skill.mjs")], { encoding: "utf8" })).toContain("validation: OK");
  });

  it("parses namespaced overlay records and the complete formula catalog", () => {
    const expected = { x: 14, linkedin: 23, facebook: 13 };
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
    const skillFrontmatter = parseFrontmatter(
      fs.readFileSync(path.join(skillDir, "SKILL.md"), "utf8"),
      "SKILL.md",
    ).data as { version: string };
    expect(isPersonalityAwareWritingSkillVersion(skillFrontmatter.version)).toBe(true);
    expect(launchWritingPatchSchema.safeParse(example("launch-writing-patch")).success).toBe(true);
    expect(evidenceSpineSchema.safeParse(example("spine")).success).toBe(true);
    const variantExample = example("variant-input") as { personality?: unknown };
    expect(variantWritingInputSchema.safeParse(variantExample).success).toBe(true);
    expect(variantPersonalityInputSchema.parse(variantExample.personality)).toEqual({
      bindingId: "pb_demo001",
    });
    expect(variantGenerationSchema.safeParse(example("generation")).success).toBe(true);
    expect(writingAuditInputSchema.safeParse(example("audit-input")).success).toBe(true);
    expect(voiceProfileInputSchema.safeParse(example("voice-profile-input")).success).toBe(true);
    expect(materializeVariantSchema.safeParse(example("materialize-input")).success).toBe(true);
    expect(approveVoiceProfileSchema.safeParse(example("approve-voice-input")).success).toBe(true);
    expect(writingIntentRecordSchema.safeParse(example("intent-objective-ask")).success).toBe(true);
    expect(approvePersonalityProjectionSchema.safeParse(example("approve-personality-input")).success).toBe(true);
    expect(sendToAgentSchema.safeParse(example("send-to-agent-body")).success).toBe(true);
    expect(example("audit-input")).not.toHaveProperty("personality");
  });

  it("pins Personality cards to fields exposed by the persisted read models", () => {
    const skill = fs.readFileSync(path.join(skillDir, "SKILL.md"), "utf8");
    const approval = fs.readFileSync(path.join(skillDir, "core/approval.md"), "utf8");
    const personality = fs.readFileSync(path.join(skillDir, "core/personality.md"), "utf8");
    const approvalCard = (text: string) => text.match(/```text\nVariant[\s\S]*?```/)?.[0];

    expect(approvalCard(skill)).toBe(approvalCard(approval));
    const variantPaths = [
      "variants[].personality.bindingId",
      "variants[].personalityState",
      "variants[].personality.identity.selfContactId",
      "variants[].personality.identity.representedOrgId",
      "variants[].personality.target.represents.kind",
    ] as const satisfies readonly (keyof VariantCardReadModelFields)[];
    for (const persistedPath of variantPaths) {
      expect(approvalCard(skill)).toContain(persistedPath);
    }
    expect(approvalCard(skill)).not.toContain("self <name>");
    expect(approvalCard(skill)).not.toContain("org <name");

    const bindingPaths = [
      "status.binding.id",
      "status.status",
      "status.host.capability",
      "status.workspace.slug",
      "status.workspace.dir",
      "status.binding.identity.selfContactId",
      "status.binding.identity.representedOrgId",
      "status.binding.sourceHash",
      "status.currentSourceHash",
      "targets[].represents.kind",
      "targets[].compatible",
      "status.detail",
    ] as const satisfies readonly (keyof BindingCardReadModelFields)[];
    for (const persistedPath of bindingPaths) {
      expect(personality).toContain(persistedPath);
    }
    expect(personality.replace(/\s+/g, " ")).toContain(
      "`Doctrine` is prescribed by this skill, not a persisted field",
    );
    expect(personality).not.toContain("<persisted recovery action>");

    const proposalPaths = [
      "proposals[].proposal.workspace.slug",
      "proposals[].proposal.workspace.id",
      "proposals[].proposal.workspace.dir",
      "proposals[].proposal.workspace.key",
      "proposals[].proposal.sourceSnapshot.self.revision",
      "proposals[].proposal.sourceSnapshot.org.revision",
      "proposals[].proposal.sourceSnapshot.voice.id",
      "proposals[].proposal.sourceSnapshot.voice.version",
      "proposals[].proposal.sourceSnapshot.voice.hash",
      "proposals[].proposal.sourceSnapshot.voice.input.profile.label",
      "proposals[].proposal.sourceSnapshot.statements.hash",
      "proposals[].proposal.files[].diff",
      "proposals[].proposal.files[].driftDiff",
      "proposals[].proposal.files[].unmanagedBytes",
      "proposals[].proposal.preflight.warnings",
      "proposals[].actions.approvalBlockers",
      "proposals[].actions.canApprove",
      "proposals[].actions.canReject",
      "proposals[].actions.canRetry",
    ] as const satisfies readonly (keyof ProposalCardReadModelFields)[];
    for (const persistedPath of proposalPaths) {
      expect(personality).toContain(persistedPath);
    }
    expect(personality).not.toContain("record.actions.approvalBlockers");

    // #549: the objective lines sit between Personality and Audit, and every value maps to a
    // persisted read-model field in approval.md's table.
    const card = approvalCard(skill)!;
    const lineOrder = ["Personality", "Objective ", "Fit ", "Ask ", "Next ", "Objective limits", "Sources ", "Audit "]
      .map((label) => card.indexOf(`\n${label}`));
    expect(lineOrder.every((index) => index > 0)).toBe(true);
    expect([...lineOrder].sort((left, right) => left - right)).toEqual(lineOrder);
    expect(approval).toContain("`O` is `launch.writing.composition.objective`");
    const objectivePaths = [
      "O.kind",
      "O.source",
      "O.brief.source.kind",
      "O.brief.source.path",
      "O.offering.name",
      "O.offering.slug",
      "O.parsed.outcome",
      "O.parsed.fit",
      "O.parsed.unknowns",
      "O.parsed.nextStep",
      "O.parsed.success",
      "O.limitations",
      "variants[].intent.goal.writingGoal",
      "variants[].intent.ask.relation",
      "variants[].intent.ask.testsUncertainty",
      "variants[].intent.ask.deferReason",
      "variants[].intent.ask.statement",
      "variants[].intent.ask.customerPain.status",
      "variants[].intent.ask.customerPain.text",
      "variants[].intent.ask.customerPain.claimIds",
      "launch.writing.spine.claims[].id",
      "launch.writing.spine.claims[].text",
      "launch.writing.spine.claims[].sensitivity",
      "launch.writing.objectiveSource.status",
      "launch.writing.objectiveSource.changedPaths",
      "variants[].revokedReason",
    ] as const satisfies readonly (keyof ObjectiveCardReadModelFields)[];
    for (const persistedPath of objectivePaths) expect(approval).toContain(`\`${persistedPath}\``);
    expect(skill).toContain("`Objective  none (this run started before run objectives)`");
    // Contract v2 addendum 1 (B3): the stale form says the drafts keep the snapshot and names a
    // revoked count only when there is one.
    expect(card).toContain("— drafts still use the snapshot[ · <n> approval(s) revoked]");
    expect(card).not.toContain("approvals not yet materialized were revoked");
    // Contract v2 §4.2 (UX experience review r1): the operator sees the evidence, never claim ids.
    expect(card).toContain('from a source — "<first claim text>"[ and <n> more]');
    expect(card).toContain('from a private source — "<first claim text>"[ and <n> more]');
    expect(card).toContain("from <n> cited source(s)");
    expect(card).not.toMatch(/claim ids?>/);
  });

  it("names only registered agent tools in operational prose", () => {
    const markdownFiles = [
      "SKILL.md", "reference.md",
      "core/claims.md", "core/voice.md", "core/audit.md", "core/adapt.md", "core/approval.md", "core/lineage.md", "core/personality.md",
      "overlays/README.md", "overlays/x.md", "overlays/linkedin.md", "overlays/facebook.md",
    ];
    const nonToolTokens = new Set([
      "adapted_from", "auto_low_risk", "content_item", "derived_from", "draft_only", "materialized_as", "pinned_superseded",
      "published_as", "rules_first", "sourced_from", "variant_locked", "voice_first",
      "legacy_unbound", "source_stale", "thread_message", "personality_binding_required",
      "personality_binding_stale", "personality_drifted", "personality_identity_mismatch",
      "personality_source_stale", "target_identity_mismatch", "workspace_mismatch",
      "personality_workspace_unavailable", "unclaimed_only",
      "relationship_only", "run_config", "template_config", "objective_source_stale", "none_assumed",
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
    for (const surface of [
      "x/post",
      "x/thread",
      "x/reply",
      "x/direct_message",
      "linkedin/post",
      "linkedin/comment",
      "linkedin/direct_message",
      "facebook/post",
      "facebook/comment",
      "facebook/direct_message",
    ]) expect(helper.hardLimit(surface)).toBe(hardLimit(surface));
    // A DM must not inherit the reply ceiling, or every nurture message audits against 280.
    expect(hardLimit("x/direct_message")).toBe(10_000);
    expect(hardLimit("x/reply")).toBe(280);
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
    const manufacturedPersonality = structuredClone(payload) as ReturnType<typeof variantInput>;
    Object.assign(manufacturedPersonality.metadata.writing, {
      personality: { bindingId: "pb_binding1", personalityHash: "a".repeat(64) },
    });
    expect(helper.precheck(manufacturedPersonality, spine, launch).problems.map((problem) => problem.reason)).toContain("personality_selector_invalid");
    const auditPersonality = structuredClone(payload) as ReturnType<typeof variantInput>;
    Object.assign(auditPersonality.metadata.writing.audit, {
      personality: { bindingId: "pb_binding1" },
    });
    expect(helper.precheck(auditPersonality, spine, launch).problems.map((problem) => problem.reason)).toContain("audit_personality_forbidden");
  });

  it("prechecks the objective reference and the ask the way the server does (#549)", async () => {
    const spine = json<{ id: string; claims: { id: string }[]; sources: { id: string }[] }>("spine.json");
    const normalized = await normalizeAccountObjective({
      raw: {
        kind: "commercial",
        brief: { kind: "inline", text: "## Outcome\nAgree to an evaluation call.\n\n## Unknowns\n- Current workflow\n- Who owns onboarding" },
      },
      source: "run_config",
      resolveWorkspace: async () => { throw new Error("no mentions, no workspace"); },
    });
    if (!normalized.ok) throw new Error(normalized.reason);
    const objective = normalized.objective;
    const relationshipOnly = await normalizeAccountObjective({
      raw: { kind: "relationship_only" },
      source: "run_config",
      resolveWorkspace: async () => { throw new Error("unused"); },
    });
    if (!relationshipOnly.ok) throw new Error(relationshipOnly.reason);
    const composition = (value: AccountObjective | null): LaunchComposition => ({
      schemaVersion: 1,
      workflowRunId: "run_fixture",
      templateId: "tpl_fixture",
      consumer: "contact_relationship_nurture",
      mandate: "assist_only",
      surfaces: ["x/reply"],
      stampedAt: 1_750_000_000,
      ...(value ? { objective: value } : {}),
    });
    const intent = (overrides: Record<string, unknown>) => ({
      schemaVersion: 1,
      intentId: "wint_fixture01",
      mandate: "assist_only",
      actions: ["draft", "audit", "propose"],
      consumer: "contact_relationship_nurture",
      lineage: { workflowRunId: "run_fixture", templateId: "tpl_fixture" },
      recipient: { kind: "contact", contactId: "contact_fixture", platform: "x" },
      goal: { kind: "relationship_goal", id: "warm_conversation", writingGoal: "replies" },
      target: { platform: "x", targetId: "target_x_fixture" },
      surface: "x/reply",
      replyContext: null,
      sourceRefs: [],
      approvalPolicy: "explicit",
      objective: { objectiveId: objective.objectiveId, hash: objective.hash },
      ask: { statement: "Ask how they onboard engineers.", relation: "tests", testsUncertainty: 2, customerPain: { status: "none_assumed" } },
      ...overrides,
    });
    const server = (record: Record<string, unknown>, scope: LaunchComposition) => {
      try {
        assertWritingIntentAuthority({ composition: scope, intent: record, surface: "x/reply", platform: "x", targetId: "target_x_fixture", workflowRunId: "run_fixture" });
        return null;
      } catch (error) {
        return ((error as { details?: { reason?: string } }).details?.reason) ?? "unknown";
      }
    };
    const helperReasons = (record: Record<string, unknown>, scope: LaunchComposition) => {
      const payload = variantInput(json<VariantFixture>("x-post.variant.json"));
      Object.assign(payload.metadata.writing, { intent: record });
      return helper.precheck(payload, spine, { ...json<Record<string, unknown>>("launch-writing.json"), composition: scope })
        .problems.map((problem) => problem.reason)
        .filter((reason) => reason.startsWith("objective_") || reason.startsWith("ask_"));
    };
    const otherRunObjective = { objectiveId: "aobj_otherrun1", hash: objective.hash };
    const cases: Array<[string, Record<string, unknown>, LaunchComposition, string | null, string[]]> = [
      ["valid tests ask", intent({}), composition(objective), null, []],
      ["objective dropped on a revision", intent({ objective: undefined }), composition(objective), "writing_intent_objective_required", ["objective_ref_missing"]],
      ["objective from another run", intent({ objective: otherRunObjective }), composition(objective), "writing_intent_objective_mismatch", ["objective_ref_mismatch"]],
      ["objective on a pre-#549 launch", intent({}), composition(null), "writing_intent_objective_not_permitted", ["objective_ref_not_permitted"]],
      ["ask missing", intent({ ask: null }), composition(objective), "writing_intent_ask_required", ["ask_missing"]],
      ["relationship_only on a commercial objective", intent({ ask: { statement: "Say congrats.", relation: "relationship_only", customerPain: { status: "none_assumed" } } }), composition(objective), "writing_intent_ask_relation_invalid", ["ask_relation_invalid"]],
      ["advances on a relationship-only objective", intent({ objective: { objectiveId: relationshipOnly.objective.objectiveId, hash: relationshipOnly.objective.hash }, ask: { statement: "Pitch.", relation: "advances", customerPain: { status: "none_assumed" } } }), composition(relationshipOnly.objective), "writing_intent_ask_relation_invalid", ["ask_relation_invalid"]],
      ["tests an unknown that does not exist", intent({ ask: { statement: "Ask.", relation: "tests", testsUncertainty: 3, customerPain: { status: "none_assumed" } } }), composition(objective), "writing_intent_ask_relation_invalid", ["ask_relation_invalid"]],
      ["defers without a reason", intent({ ask: { statement: "Congrats.", relation: "defers", customerPain: { status: "none_assumed" } } }), composition(objective), "writing_intent_ask_relation_invalid", ["ask_relation_invalid"]],
    ];
    for (const [label, record, scope, serverReason, helperReason] of cases) {
      expect({ label, reason: server(record, scope) }).toEqual({ label, reason: serverReason });
      expect({ label, reasons: helperReasons(record, scope) }).toEqual({ label, reasons: helperReason });
    }

    // Spine resolution: the server rejects these in validateCrossDocuments; the helper mirrors it.
    const painFromNowhere = intent({ ask: { statement: "Ask.", relation: "advances", customerPain: { status: "evidenced", claimIds: ["clm_unknown01"] }, evidenceSourceIds: ["src_unknown01"] } });
    expect(helperReasons(painFromNowhere, composition(objective))).toEqual(["ask_claim_unknown", "ask_source_unknown"]);
    const evidenced = intent({ ask: { statement: "Ask.", relation: "advances", customerPain: { status: "evidenced", claimIds: [spine.claims[0].id] }, evidenceSourceIds: [spine.sources[0].id] } });
    expect(helperReasons(evidenced, composition(objective))).toEqual([]);
  });
});

let personalityStorageDir = "";

describe.sequential("signals-writing fixture integration", () => {
  beforeEach(() => {
    resetCoreTables();
    resetPersonalityStore();
    personalityStorageDir = fs.mkdtempSync(path.join(tmpdir(), "signals-380-writing-skill-"));
    db.insert(browserConnections).values({ id: "connection_fixture", sessionName: "writing-skill", kind: "dedicated", status: "active" }).run();
    for (const [id, platform] of [["target_x_fixture", "x"], ["target_linkedin_fixture", "linkedin"], ["target_facebook_fixture", "facebook"]] as const) {
      db.insert(platformTargets).values({ id, connectionId: "connection_fixture", platform, kind: "profile", name: `${platform} fixture`, capabilities: "[]", status: "active" }).run();
    }
  });

  afterEach(() => {
    fs.rmSync(personalityStorageDir, { recursive: true, force: true });
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

  it("stamps bound Personality across distinct surfaces and materializes the guarded result", async () => {
    const workspace = personalityWorkspace(personalityStorageDir);
    const authority = await installPersonalityBinding(workspace);
    await setTargetRepresentation({
      targetId: "target_x_fixture",
      bindingId: authority.binding.id,
      represents: { kind: "self", contactId: authority.self.id },
      evidence: { kind: "ui", route: "/settings/personality" },
    }, authority.dependencies);

    const launchWriting = json<Record<string, unknown>>("launch-writing.json");
    const launch = await invokeAgentTool("upsert_launch", {
      name: "Personality-aware skill fixture",
      metadata: { writing: launchWriting },
    }) as { id: string };
    const storedLaunch = getLaunchById(launch.id)!;
    const spine = JSON.parse(storedLaunch.metadata ?? "{}").writing.spine as Record<string, unknown>;
    const fixtures = ["x-post.variant.json", "x-thread.variant.json"]
      .map((name) => json<VariantFixture>(name));
    const persisted: Array<Awaited<ReturnType<typeof upsertVariantUseCase>>> = [];
    for (const fixture of fixtures) {
      const input = variantInput(fixture, spine, undefined, {
        bindingId: authority.binding.id,
        skillVersion: "1.1.0",
      });
      input.launchId = launch.id;
      persisted.push(await upsertVariantUseCase(input, authority.dependencies));
    }

    const rows = persisted.map((result) => db.select().from(variants)
      .all().find((row) => row.id === result.id)!);
    expect(new Set(rows.map((row) => row.body)).size).toBe(2);
    expect(rows.map((row) => JSON.parse(row.metadata ?? "{}").writing.spine.hash))
      .toEqual(Array(2).fill(spine.hash));
    for (const row of rows) {
      const writing = JSON.parse(row.metadata ?? "{}").writing;
      expect(writing.personality).toMatchObject({
        bindingId: authority.binding.id,
        personalityHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        identity: { selfContactId: authority.self.id },
        target: { targetId: "target_x_fixture", represents: { kind: "self" } },
      });
      expect(writing.audit.personality).toMatchObject({
        bindingId: authority.binding.id,
        statusAtAudit: "bound",
        currentSourceHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      });
    }

    await expect(withPersonalityWritingGuard(
      (guard, tx) => materializeVariantWithRunner({ variantId: persisted[0].id }, guard, tx),
      authority.dependencies,
    )).resolves.toMatchObject({ contentItemId: expect.any(String) });

    const missingSelector = variantInput(fixtures[0], spine, undefined, { skillVersion: "1.1.0" });
    missingSelector.launchId = launch.id;
    await expect(upsertVariantUseCase(missingSelector, authority.dependencies)).rejects.toMatchObject({
      details: { reason: "personality_binding_required" },
    });
    const staleSelector = variantInput(fixtures[0], spine, undefined, {
      bindingId: "pb_wrong01",
      skillVersion: "1.1.0",
    });
    staleSelector.launchId = launch.id;
    await expect(upsertVariantUseCase(staleSelector, authority.dependencies)).rejects.toMatchObject({
      details: { reason: "personality_binding_stale" },
    });
  });

  it("rejects an audited aware payload while the workspace is unbound", async () => {
    const workspace = personalityWorkspace(personalityStorageDir);
    createContact({ name: "Unbound writer", isSelf: true });
    const dependencies = personalityGuardDependencies(workspace);
    const launchWriting = json<Record<string, unknown>>("launch-writing.json");
    const launch = await invokeAgentTool("upsert_launch", {
      name: "Unbound aware skill fixture",
      metadata: { writing: launchWriting },
    }) as { id: string };
    const storedLaunch = getLaunchById(launch.id)!;
    const spine = JSON.parse(storedLaunch.metadata ?? "{}").writing.spine as Record<string, unknown>;
    const input = variantInput(json<VariantFixture>("x-post.variant.json"), spine, undefined, {
      skillVersion: "1.1.0",
    });
    input.launchId = launch.id;
    await expect(upsertVariantUseCase(input, dependencies)).rejects.toMatchObject({
      details: { reason: "personality_binding_required" },
    });
  });

  it("persists a labelled targetless unaudited 1.1.0 sketch while unbound", async () => {
    const workspace = personalityWorkspace(personalityStorageDir);
    createContact({ name: "Unbound sketch writer", isSelf: true });
    const dependencies = personalityGuardDependencies(workspace);
    const launchWriting = json<Record<string, unknown>>("launch-writing.json");
    const launch = await invokeAgentTool("upsert_launch", {
      name: "Legacy-unbound sketch fixture",
      metadata: { writing: launchWriting },
    }) as { id: string };
    const storedLaunch = getLaunchById(launch.id)!;
    const spine = JSON.parse(storedLaunch.metadata ?? "{}").writing.spine as Record<string, unknown>;
    const input = variantInput(json<VariantFixture>("x-post.variant.json"), spine, undefined, {
      skillVersion: "1.1.0",
    });
    input.launchId = launch.id;
    const mutable = input as unknown as {
      label?: string;
      metadata: { writing: Record<string, unknown> };
    };
    mutable.label = "legacy_unbound sketch";
    delete mutable.metadata.writing.targetId;
    delete mutable.metadata.writing.personality;
    mutable.metadata.writing.audit = null;

    const persisted = await upsertVariantUseCase(input, dependencies);
    expect(persisted).toMatchObject({
      label: "x/post · legacy_unbound sketch",
      writing: true,
      created: true,
    });
    const row = db.select().from(variants).all().find((candidate) => candidate.id === persisted.id)!;
    const writing = JSON.parse(row.metadata ?? "{}").writing;
    expect(writing).not.toHaveProperty("targetId");
    expect(writing).not.toHaveProperty("personality");
    expect(writing.audit).toBeNull();
  });
});
