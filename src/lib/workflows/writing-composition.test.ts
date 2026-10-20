import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildAgentWorkflowBrief, getTemplateToolsHint } from "@/lib/workflows/template-brief";
import { buildContactNurtureTemplateConfig } from "@/lib/workflows/contact-relationship-nurture";
import {
  buildWritingBriefSection,
  buildWritingTemplateConfig,
} from "@/lib/workflows/signals-writing";
import {
  WRITING_HARD_RULES,
  WRITING_LANE_DRIFTED_STEP,
  WRITING_LANE_GATE_STEP,
  WRITING_LINEAGE_STEP,
  WRITING_PERSONALITY_FILES_STEP,
  WRITING_SKILL_LOAD_STEP,
  WRITING_SOURCE_STEPS,
} from "@/lib/workflows/writing-contract";
import {
  WRITING_INTENT_CONFIG_KEY,
  buildComposedWritingBriefSection,
  buildWritingIntentCompositionConfig,
  isWritingComposedConfig,
  readWritingIntentComposition,
} from "@/lib/workflows/writing-composition";
import { writingIntentDraftSchema } from "@/lib/writing/writing-intent";
import {
  normalizeAccountObjective,
  type AccountObjective,
} from "@/lib/writing/account-objective";
import { buildContactNurtureBriefSection } from "@/lib/workflows/contact-relationship-nurture";
import { COMMERCIAL_BRIEF, PRODUCTS_FIXTURE } from "@/test/account-objective-fixture";

const composition = readWritingIntentComposition(
  buildWritingIntentCompositionConfig({ consumer: "contact_relationship_nurture" }),
)!;

function composedFor(
  target: { platform: string; targetId: string | null } | null,
  // `null` means "this dispatch was issued no token", which is distinct from the default.
  writingScopeToken: string | null = "run_1.secret-token",
): string {
  return buildComposedWritingBriefSection({
    composition,
    templateId: "tpl_1",
    templateName: "Contact Relationship Nurture",
    workflowRunId: "run_1",
    signalsBaseUrl: "http://127.0.0.1:3000",
    target,
    writingScopeToken: writingScopeToken ?? undefined,
  });
}

/** Parse the fenced intent sample the brief hands the agent. */
function sampleIntent(brief: string): Record<string, unknown> {
  const fenced = brief.split("```json\n")[1]?.split("\n```")[0];
  if (!fenced) throw new Error("brief has no intent sample");
  return JSON.parse(fenced) as Record<string, unknown>;
}

const template = {
  id: "tpl_1",
  name: "Contact Relationship Nurture",
  description: "Nurture",
  templateType: "nurture" as const,
  platform: null,
  systemPrompt: "Follow the contract.",
  targetPersona: null,
};

const composed = composedFor({ platform: "x", targetId: "tgt_x" }, "run_1.secret-token");

const platformNative = buildWritingBriefSection({
  template: { id: "tpl_2", name: "Platform-native writing" },
  config: buildWritingTemplateConfig({
    launchId: "launch_1",
    surfaces: [{ platform: "x", surface: "x/post", targetId: "tgt_x" }],
  }),
  workflowRunId: "run_2",
  signalsBaseUrl: "http://127.0.0.1:3000",
});

describe("writing-intent composition opt-in", () => {
  it("validates the bounded nested config", () => {
    const config = buildWritingIntentCompositionConfig({
      consumer: "contact_relationship_nurture",
    });
    expect(isWritingComposedConfig(config)).toBe(true);
    expect(readWritingIntentComposition(config)?.surfaces).toContain("x/reply");
    expect(isWritingComposedConfig({})).toBe(false);
  });

  it("rejects a widened mandate, policy, or surface", () => {
    const base = buildWritingIntentCompositionConfig({
      consumer: "contact_relationship_nurture",
    })[WRITING_INTENT_CONFIG_KEY] as Record<string, unknown>;
    for (const override of [
      { mandate: "autonomous" },
      { approvalPolicy: "auto_low_risk" },
      { surfaces: ["x/post"] },
      { surfaces: [] },
      { consumer: "profile_publish" },
      { version: 2 },
    ]) {
      expect(
        readWritingIntentComposition({ [WRITING_INTENT_CONFIG_KEY]: { ...base, ...override } }),
      ).toBeNull();
    }
  });
});

describe("composed writing brief", () => {
  it("renders the same Personality, source, and hard rules as the Platform-native lane", () => {
    for (const shared of [
      WRITING_SKILL_LOAD_STEP,
      WRITING_PERSONALITY_FILES_STEP,
      ...WRITING_SOURCE_STEPS,
      WRITING_LANE_GATE_STEP,
      WRITING_LANE_DRIFTED_STEP,
      WRITING_LINEAGE_STEP,
      ...WRITING_HARD_RULES,
    ]) {
      expect(composed).toContain(shared);
      expect(platformNative).toContain(shared);
    }
  });

  it("does not turn the workflow into the Platform-native writing template", () => {
    expect(composed).toContain("Shared writing-intent contract");
    expect(composed).not.toContain("Signals Writing execution contract");
    expect(composed).not.toContain("draft one platform-native artifact per surface");
    expect(composed).toContain("draft one artifact per writing intent");
  });

  it("requires explicit approval and never offers the auto_low_risk bypass", () => {
    expect(composed).toContain("wait for fresh explicit user approval");
    expect(composed).toContain("`auto_low_risk` does not apply to composed proposals");
    expect(composed).not.toContain(
      "call `materialize_variant` without a user approval payload",
    );
    expect(platformNative).toContain("For `auto_low_risk`");
  });

  it("has no legacy-unbound sketch lane", () => {
    expect(composed).toContain("For `unbound`, refuse");
    expect(composed).not.toContain("legacy_unbound sketch");
    expect(platformNative).toContain("legacy_unbound sketch");
  });

  it("reports honest capability rows and forbids external action", () => {
    expect(composed).toContain("x/reply (platform=x, target=tgt_x): draft=supported");
    expect(composed).toContain("publish=draft_only");
    expect(composed).toContain(
      "Do not publish, send, comment, reply, schedule, or open a publish job from this workflow",
    );
  });

  it("offers only the acting platform's surfaces", () => {
    const linkedin = composedFor({ platform: "linkedin", targetId: "tgt_li" });
    expect(linkedin).toContain("linkedin/comment (platform=linkedin, target=tgt_li)");
    expect(linkedin).toContain("linkedin/direct_message");
    expect(linkedin).not.toContain("x/reply");
    expect(linkedin).not.toContain("facebook/comment");
    expect(linkedin).toContain("Acting platform: linkedin");
  });

  it("emits an intent sample the contract actually accepts, on every platform", () => {
    for (const platform of ["x", "linkedin", "facebook"]) {
      const sample = sampleIntent(composedFor({ platform, targetId: `tgt_${platform}` }));
      expect((sample.target as { platform: string }).platform).toBe(platform);
      expect(sample.surface).toMatch(new RegExp(`^${platform}/`));
      const parsed = writingIntentDraftSchema.safeParse({
        ...sample,
        intentId: "wint_sample1",
        recipient: { kind: "contact", contactId: "contact_1", platform },
        goal: { kind: "relationship_goal", id: "follow_back", writingGoal: "follows" },
        replyContext: null,
        sourceRefs: [],
      });
      expect(parsed.success).toBe(true);
    }
  });

  it("does not guess a platform when no acting target is resolved", () => {
    const unresolved = composedFor(null);
    expect(unresolved).toContain("No acting target is configured");
    expect(unresolved).toContain("x/reply");
    expect(unresolved).toContain("linkedin/comment");
    expect(unresolved).toContain("facebook/direct_message");
    expect(unresolved).not.toContain("Acting platform:");
  });

  it("refuses outright when the acting platform has no enabled surface", () => {
    const unsupported = composedFor({ platform: "threads", targetId: "tgt_th" });
    expect(unsupported).toContain("No enabled writing surface exists for the acting platform threads");
    expect(unsupported).toContain("propose nothing");
    expect(unsupported).not.toContain("x/reply");
  });

  it("hands the agent its dispatch capability and says what it is for", () => {
    expect(composed).toContain('writingScopeToken: "run_1.secret-token"');
    expect(composed).toContain("issued to this dispatch");
    expect(composed).toContain("Naming the run in `writing.runs` does not bind anything");
    expect(composed).toContain("do not share the token or reuse another run's");
  });

  it("refuses to describe a proposal lane when no token was issued", () => {
    const unscoped = composedFor({ platform: "x", targetId: "tgt_x" }, null);
    expect(unscoped).toContain("No writing scope token was issued for this run");
    expect(unscoped).toContain("no proposal can be created");
    expect(unscoped).not.toContain("writingScopeToken:");
  });

  it("names the recipient boundary explicitly", () => {
    expect(composed).toContain("Workspace Personality answers \"who is speaking\"");
    expect(composed).toContain(
      "never copy contact facts, persona attributes, relationship notes, or private CRM fields",
    );
    expect(composed).toContain("Only `sourceRefs` evidence may become a fact");
  });
});

describe("brief composition boundary", () => {
  it("attaches the shared contract to any opted-in workflow", () => {
    const brief = buildAgentWorkflowBrief({
      template,
      workflowRunId: "run_1",
      config: { ...buildContactNurtureTemplateConfig(), targetPlatform: "linkedin" },
      signalsBaseUrl: "http://127.0.0.1:3000",
    });
    expect(brief).toContain("Shared writing-intent contract");
    expect(brief).toContain("Contact Relationship Nurture execution contract");
    expect(brief).not.toContain("Signals Writing execution contract");
    expect(brief).toContain("linkedin/comment");
  });

  it("advertises the writing tools the composed contract actually requires", () => {
    const config = buildContactNurtureTemplateConfig();
    const tools = getTemplateToolsHint("nurture", config);

    for (const tool of [
      "get_writing_context",
      "upsert_launch",
      "upsert_variant",
      "materialize_variant",
      "revoke_variant_approval",
      "complete_workflow_run",
    ]) {
      expect(tools).toContain(tool);
    }
    // The workflow's own category tools survive alongside them.
    expect(tools).toContain("query_contacts");
    expect(tools).toContain("get_contact");
    expect(new Set(tools).size).toBe(tools.length);
    expect(getTemplateToolsHint("nurture", {})).not.toContain("upsert_variant");
  });

  it("prints those tools in the brief's invoke requirement", () => {
    const brief = buildAgentWorkflowBrief({
      template,
      workflowRunId: "run_1",
      config: buildContactNurtureTemplateConfig(),
      signalsBaseUrl: "http://127.0.0.1:3000",
    });
    const requirement = brief.split("8. For single-record edits, invoke tools (")[1]?.split(")")[0];

    expect(requirement).toContain("upsert_variant");
    expect(requirement).toContain("materialize_variant");
    expect(requirement).toContain("query_contacts");
  });

  it("leaves a workflow without the opt-in untouched", () => {
    const brief = buildAgentWorkflowBrief({
      template,
      workflowRunId: "run_1",
      config: {},
      signalsBaseUrl: "http://127.0.0.1:3000",
    });
    expect(brief).not.toContain("Shared writing-intent contract");
    expect(brief).not.toContain("Signals Writing execution contract");
  });

  it("keeps the Platform-native lane on its own contract", () => {
    const brief = buildAgentWorkflowBrief({
      template: { ...template, name: "Platform-native writing", templateType: "content" },
      workflowRunId: "run_2",
      config: buildWritingTemplateConfig({
        launchId: "launch_1",
        surfaces: [{ platform: "x", surface: "x/post" }],
      }),
      signalsBaseUrl: "http://127.0.0.1:3000",
    });
    expect(brief).toContain("Signals Writing execution contract");
    expect(brief).not.toContain("Shared writing-intent contract");
  });
});

describe("account objective in the composed brief (#549)", () => {
  let workspaceDir = "";
  let commercial: AccountObjective;
  let bare: AccountObjective;
  let relationshipOnly: AccountObjective;

  async function normalize(raw: unknown): Promise<AccountObjective> {
    const result = await normalizeAccountObjective({
      raw,
      source: "run_config",
      resolveWorkspace: async () => ({ slug: "signals", id: "ws_1", dir: workspaceDir, key: "k".repeat(32) }),
      now: 1_760_000_000,
    });
    if (!result.ok) throw new Error(`fixture objective refused: ${result.reason}`);
    return result.objective;
  }

  function briefWith(objective: AccountObjective | null, target = { platform: "linkedin", targetId: "tgt_li" }) {
    return buildComposedWritingBriefSection({
      composition,
      templateId: "tpl_1",
      templateName: "Contact Relationship Nurture",
      workflowRunId: "run_1",
      signalsBaseUrl: "http://127.0.0.1:3000",
      target,
      writingScopeToken: "run_1.secret-token",
      objective,
    });
  }

  beforeAll(async () => {
    // A plain temp directory, not the Personality fixture workspace: writing BRAND.md into a bound
    // workspace would drift the binding.
    workspaceDir = fs.mkdtempSync(path.join(tmpdir(), "signals-549-brief-"));
    fs.writeFileSync(path.join(workspaceDir, "PRODUCTS.md"), PRODUCTS_FIXTURE);
    fs.writeFileSync(path.join(workspaceDir, "BRAND.md"), "# Brand\n\nPlain words, no hype.\n");
    commercial = await normalize({ kind: "commercial", brief: { kind: "inline", text: COMMERCIAL_BRIEF } });
    bare = await normalize({
      kind: "commercial",
      brief: { kind: "inline", text: "## Outcome\nA reply that names their review process.\n\nSee @VOICE.md." },
    });
    relationshipOnly = (await normalizeAccountObjective({
      raw: undefined,
      source: "run_config",
      resolveWorkspace: async () => { throw new Error("not needed"); },
    }) as { ok: true; objective: AccountObjective }).objective;
  });

  afterAll(() => {
    fs.rmSync(workspaceDir, { recursive: true, force: true });
  });

  it("renders the stamped brief, mention excerpts and the outcome-versus-metric rule", () => {
    const brief = briefWith(commercial);
    expect(brief).toContain("Account objective — operator intent, server-stamped at dispatch; never edit it");
    expect(brief).toContain(COMMERCIAL_BRIEF);
    expect(brief).toContain("@PRODUCTS.md#engineering-workflow — Engineering Workflow (Agent Runtime) (this run's offering):");
    expect(brief).toContain("- **Slug:** `engineering-workflow`");
    expect(brief).toContain("@BRAND.md:");
    expect(brief).toContain("Plain words, no hype.");
    expect(brief).toContain("This snapshot is the objective for this run. The same files in your working directory may have changed since; if they differ, say so in the thread and keep drafting against the snapshot.");
    expect(brief).toContain("a reply is not the outcome");
    expect(brief).toContain("`offering:engineering-workflow#proof[i]`");
    expect(brief).toContain("1. Whether they use a coding agent today");
    expect(brief).toContain(`objective: ${JSON.stringify({ objectiveId: commercial.objectiveId, hash: commercial.hash })}`);
    expect(brief).toContain("write the ask");
    expect(brief).toContain("post it in this thread");
    expect(brief).toContain("`testsUncertainty` to its number in the Unknowns list (1–1)");
    expect(brief).toContain("`core/claim/no-assumed-customer-pain`");
    expect(brief).toContain("Limitations: none.");
  });

  it("puts the exact objective reference and a valid ask in the intent sample", () => {
    for (const objective of [commercial, bare, relationshipOnly]) {
      const sample = sampleIntent(briefWith(objective));
      expect(sample.objective).toEqual({ objectiveId: objective.objectiveId, hash: objective.hash });
      const parsed = writingIntentDraftSchema.safeParse({
        ...sample,
        intentId: "wint_sample1",
        recipient: { kind: "contact", contactId: "contact_1", platform: "linkedin" },
        goal: { kind: "relationship_goal", id: "warm_conversation", writingGoal: "replies" },
        replyContext: null,
        sourceRefs: [],
      });
      expect(parsed.success).toBe(true);
    }
    expect((sampleIntent(briefWith(commercial)).ask as { relation: string }).relation).toBe("tests");
    expect((sampleIntent(briefWith(bare)).ask as { relation: string }).relation).toBe("advances");
    expect((sampleIntent(briefWith(relationshipOnly)).ask as { relation: string }).relation).toBe("relationship_only");
  });

  it("forbids any pitch under a relationship-only objective", () => {
    const brief = briefWith(relationshipOnly);
    expect(brief).toContain("Do not introduce an offering, pricing, a product or a pitch; the ask relation is `relationship_only`.");
    expect(brief).toContain("no objective was given for this run, so Signals stamped relationship-only");
    expect(brief).toContain("`relationship_only` — the only legal value on this run.");
    expect(brief).not.toContain("`advances` —");
    expect(brief).not.toContain("Seller context");
  });

  it("binds every limitation the server stamped", () => {
    expect(bare.limitations).toEqual(["offering_missing", "mention_unresolved", "fit_missing", "success_missing"]);
    const brief = briefWith(bare);
    expect(brief).toContain("`offering_missing` — no product from PRODUCTS.md is mentioned. Do not name or pitch an offering; asks are discovery only.");
    expect(brief).toContain("`mention_unresolved` — @VOICE.md could not be read");
    expect(brief).toContain("@VOICE.md: not found (file_absent); you do not have it.");
    expect(brief).toContain("`fit_missing` — the brief has no Fit. The ask may test whether there is a fit; it must not presume one.");
    expect(brief).toContain("`success_missing` — the brief has no Success");
    expect(brief).toContain("`tests` — not available: the brief lists no Unknowns.");
  });

  it("renders nothing new for a run dispatched before account objectives", () => {
    const brief = briefWith(null);
    expect(brief).not.toContain("Account objective");
    expect(sampleIntent(brief)).not.toHaveProperty("objective");
    expect(sampleIntent(brief)).not.toHaveProperty("ask");
  });

  it("renders the objective block, not a JSON copy, and points N4 at it", () => {
    const config = { ...buildContactNurtureTemplateConfig(), targetPlatform: "linkedin", accountObjective: commercial };
    const brief = buildAgentWorkflowBrief({
      template,
      workflowRunId: "run_1",
      config,
      signalsBaseUrl: "http://127.0.0.1:3000",
      writingScopeToken: "run_1.secret-token",
    });
    expect(brief).toContain("Account objective — operator intent");
    expect(brief).not.toContain('"accountObjective"');
    expect(brief).not.toContain(commercial.sourceHash);
    expect(brief).toContain("choose the touchpoint deliverable above to serve the ask, not the reverse");

    const legacy = buildContactNurtureBriefSection({
      workflowRunId: "run_1",
      config: buildContactNurtureTemplateConfig(),
      signalsBaseUrl: "http://127.0.0.1:3000",
    });
    expect(legacy).not.toContain("Account objective");
  });
});
