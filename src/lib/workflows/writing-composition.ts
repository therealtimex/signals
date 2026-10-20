/**
 * The reusable opt-in that attaches the shared writing contract to a workflow.
 *
 * Before #410 the only way a brief could carry the writing contract was
 * `isSignalsWritingTemplateConfig` — so any workflow that wanted Personality-bound voice had to
 * *become* the Platform-native writing template, or fork the instructions. This key is the third
 * option: a workflow declares which consumer it is and which surfaces it may propose on, and the
 * shared pipeline supplies everything else.
 *
 * Opting a new workflow in is two edits and no new engine: add it to `WRITING_INTENT_CONSUMERS`
 * with its allowed surfaces, then put `buildWritingIntentCompositionConfig(...)` in its template
 * config. See `docs/composable-writing-intent.md`.
 */

import type { SurfaceId } from "@/lib/writing/surfaces";
// Type-only: `account-objective.ts` reads the workspace through `node:fs`, and this module is
// bundled into the dashboard (template builder preview, nurture fields), so it must stay
// browser-safe. The record it renders was normalized and stamped by the server at dispatch.
import type { AccountObjective, AccountObjectiveLimitation } from "@/lib/writing/account-objective";
import {
  WRITING_INTENT_APPROVAL_POLICY,
  WRITING_INTENT_SCHEMA_VERSION,
  type WritingIntentComposition,
} from "@/lib/writing/writing-intent";

// The composition config lives with the contract (`writing-intent.ts`) because the server reads it
// to decide whether a run is composed. Re-exported here so brief-layer callers keep one import.
export {
  WRITING_INTENT_CONFIG_KEY,
  WRITING_INTENT_CONFIG_VERSION,
  buildWritingIntentCompositionConfig,
  isWritingComposedConfig,
  readWritingIntentComposition,
  type WritingIntentComposition,
} from "@/lib/writing/writing-intent";
import {
  WRITING_HARD_RULES,
  WRITING_LANE_DRIFTED_STEP,
  WRITING_LANE_GATE_STEP,
  WRITING_LANE_REVISION_STEP,
  WRITING_LINEAGE_STEP,
  WRITING_PERSONALITY_FILES_STEP,
  WRITING_SKILL_LOAD_STEP,
  WRITING_SOURCE_STEPS,
  buildWritingCapabilityRows,
  buildWritingLaneBoundStep,
} from "@/lib/workflows/writing-contract";

/** Run config key the dispatcher writes the normalized account objective under (#549). */
export const ACCOUNT_OBJECTIVE_RUN_CONFIG_KEY = "accountObjective";

/**
 * Structural read of the server-stamped account objective in a run config.
 *
 * Not a validator: the record was normalized and hash-stamped at dispatch, and every variant write
 * is checked against the copy stamped on the launch. This only decides whether there is a record
 * to render, without pulling the server-side schema module into a browser bundle.
 */
export function readRunAccountObjective(config: Record<string, unknown>): AccountObjective | null {
  const value = config[ACCOUNT_OBJECTIVE_RUN_CONFIG_KEY];
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Partial<AccountObjective>;
  if (
    record.schemaVersion !== 2
    || typeof record.objectiveId !== "string"
    || !/^aobj_[A-Za-z0-9_-]{6,}$/.test(record.objectiveId)
    || typeof record.hash !== "string"
    || (record.kind !== "commercial" && record.kind !== "relationship_only")
    || !Array.isArray(record.mentions)
    || !Array.isArray(record.limitations)
  ) {
    return null;
  }
  return value as AccountObjective;
}

/** Longest run of `~` in `text` plus one, at least four: a fence the verbatim text cannot close. */
function fenceFor(text: string): string {
  const longest = Math.max(0, ...[...text.matchAll(/~+/g)].map((match) => match[0].length));
  return "~".repeat(Math.max(4, longest + 1));
}

function fenced(text: string, info = "markdown"): string[] {
  const fence = fenceFor(text);
  return [`${fence}${info}`, text, fence];
}

const SOURCE_LABELS: Record<AccountObjective["source"], string> = {
  run_config: "set when the run started",
  template_config: "from the template's default",
  default: "no objective was given for this run, so Signals stamped relationship-only",
};

function limitationConsequence(code: AccountObjectiveLimitation, objective: AccountObjective): string {
  const unresolvedEntries: string[] = [];
  const entryTokens: string[] = [];
  const unresolvedFiles: string[] = [];
  for (const mention of objective.mentions) {
    const entry = mention.path === "PRODUCTS.md" && Boolean(mention.anchor);
    if (entry) {
      entryTokens.push(mention.resolved?.entry?.name ? `${mention.resolved.entry.name} (${mention.raw})` : mention.raw);
      if (!mention.resolved) unresolvedEntries.push(mention.raw);
    } else if (!mention.resolved) {
      unresolvedFiles.push(mention.raw);
    }
  }
  switch (code) {
    case "offering_missing":
      return "`offering_missing` — no product from PRODUCTS.md is mentioned. Do not name or pitch an offering; asks are discovery only.";
    case "offering_unresolved":
      return `\`offering_unresolved\` — ${unresolvedEntries.join(", ") || "the product mention"} did not resolve in PRODUCTS.md. Treat the offering as missing: do not name or pitch an offering; asks are discovery only.`;
    case "offering_ambiguous":
      return `\`offering_ambiguous\` — the brief mentions more than one product (${entryTokens.join(", ")}). Do not name or pitch any of them; asks are discovery only.`;
    case "offering_proof_missing":
      return `\`offering_proof_missing\` — ${objective.offering?.name ?? "the offering"} has no proof points in PRODUCTS.md. Make no claim about what it does or achieves.`;
    case "mention_unresolved":
      return `\`mention_unresolved\` — ${unresolvedFiles.join(", ")} could not be read, so you do not have ${unresolvedFiles.length === 1 ? "it" : "them"}. Do not guess what ${unresolvedFiles.length === 1 ? "it says" : "they say"}.`;
    case "fit_missing":
      return "`fit_missing` — the brief has no Fit. The ask may test whether there is a fit; it must not presume one.";
    case "success_missing":
      return "`success_missing` — the brief has no Success, so success is undefined for this run. The next step still applies.";
  }
}

/**
 * The "Account objective" block of the composed contract (#549, spec §10 / §18.11).
 *
 * Renders the stamped snapshot verbatim — never the workspace files, which may have changed since
 * dispatch — plus the rules the agent's `ask` must follow. The objective is operator intent; the
 * agent references it by `{ objectiveId, hash }` and never edits it.
 */
export function buildAccountObjectiveBriefBlock(objective: AccountObjective): string[] {
  const reference = JSON.stringify({ objectiveId: objective.objectiveId, hash: objective.hash });
  const lines = [
    `Account objective — operator intent, server-stamped at dispatch; never edit it (objective ${objective.objectiveId}):`,
    `- Kind: ${objective.kind === "commercial" ? "Business outcome (`commercial`)" : "Relationship only (`relationship_only`)"} · source: ${SOURCE_LABELS[objective.source]}.`,
    `- Every writing intent on this run must carry \`objective: ${reference}\` exactly. Signals rejects an intent — including an in-place revision or a derived alternative — that omits or changes it.`,
    "- The relationship goal's `writingGoal` is the platform metric the spine is scored against (for example replies); the business outcome is what the operator wants to happen for the account. Keep them separate: a reply is not the outcome.",
  ];

  if (objective.kind === "relationship_only") {
    lines.push(
      "- Do not introduce an offering, pricing, a product or a pitch; the ask relation is `relationship_only`.",
      ...buildAskRules(objective),
    );
    return lines;
  }

  const brief = objective.brief!;
  lines.push(
    "- This snapshot is the objective for this run. The same files in your working directory may have changed since; if they differ, say so in the thread and keep drafting against the snapshot.",
    `- Brief: ${brief.source.kind === "saved" ? `saved brief ${brief.source.path}` : "written for this run"}. As written:`,
    ...fenced(brief.text),
  );
  if (objective.mentions.length) {
    lines.push("- Mentioned files (snapshot excerpts, in the order the brief mentions them):");
    for (const mention of objective.mentions) {
      if (!mention.resolved) {
        lines.push(`  - ${mention.raw}: not found (${mention.unresolvedReason ?? "unresolved"}); you do not have it.`);
        continue;
      }
      const name = mention.resolved.entry ? ` — ${mention.resolved.entry.name}` : "";
      const offering = objective.offering && objective.offering.mentionIndex === objective.mentions.indexOf(mention)
        ? " (this run's offering)"
        : "";
      lines.push(`  - ${mention.raw}${name}${offering}:`, ...fenced(mention.resolved.excerpt));
    }
  }
  const unknowns = objective.parsed?.unknowns ?? [];
  if (unknowns.length) {
    lines.push("- Unknowns, numbered as the operator sees them on the card:");
    unknowns.forEach((unknown, index) => lines.push(`  ${index + 1}. ${unknown}`));
  }
  if (objective.limitations.length) {
    lines.push("- Limitations Signals found — each one binds every draft on this run:");
    for (const code of objective.limitations) lines.push(`  - ${limitationConsequence(code, objective)}`);
  } else {
    lines.push("- Limitations: none.");
  }
  lines.push(
    objective.offering
      ? `- Seller context: offering text is context, not evidence. A proof point becomes a fact only through a spine \`note\` source whose text is copied verbatim from the entry and whose claim \`locator\` is \`offering:${objective.offering.slug}#proof[i]\` (i = the proof point's 0-based position).`
      : "- Seller context: offering text is context, not evidence. A proof point becomes a fact only through a spine `note` source copied verbatim with claim `locator` `offering:<slug>#proof[i]`.",
    ...buildAskRules(objective),
  );
  return lines;
}

function buildAskRules(objective: AccountObjective): string[] {
  const unknownCount = objective.parsed?.unknowns.length ?? 0;
  return [
    "- Ask: before drafting any unit for a contact, write the ask (statement, relation, customer pain) to this run's working file (`workflow-runs/<runId>/writing/`) and post it in this thread. Persist it as `metadata.writing.intent.ask` on the first `upsert_variant`; the persisted record proves the ask existed at first persist, the thread proves the order.",
    "- `ask.relation`:",
    ...(objective.kind === "relationship_only"
      ? ["  - `relationship_only` — the only legal value on this run."]
      : [
          "  - `advances` — the ask moves the account toward the business outcome (for example proposes the next step).",
          unknownCount
            ? `  - \`tests\` — the ask is designed to resolve one named unknown; set \`testsUncertainty\` to its number in the Unknowns list (1–${unknownCount}).`
            : "  - `tests` — not available: the brief lists no Unknowns.",
          "  - `defers` — this touch deliberately does not advance or test the objective (a relationship nudge, thank-you or congratulation); `deferReason` says why. Allowed and visible on the card — never silent.",
          "  - `relationship_only` is not valid on a Business outcome run.",
        ]),
    "- `ask.customerPain`: `{ \"status\": \"none_assumed\" }`, `{ \"status\": \"evidenced\", \"claimIds\": [\"clm_…\"] }` (each id a spine claim), or `{ \"status\": \"asked\", \"text\": \"…\" }` (a hypothesis the draft asks about). The draft never asserts that the recipient has a problem, pain, or need unless a spine claim evidences it (`core/claim/no-assumed-customer-pain`). `ask.evidenceSourceIds` may list spine `src_` ids the ask leans on.",
    "- Editing the ask on a revision is allowed: it stales the audit and revokes approval, so the operator re-approves the new ask.",
  ];
}

function sampleAsk(objective: AccountObjective): Record<string, unknown> {
  if (objective.kind === "relationship_only") {
    return {
      statement: "<what this touch asks for, in one or two sentences>",
      relation: "relationship_only",
      customerPain: { status: "none_assumed" },
    };
  }
  return (objective.parsed?.unknowns.length ?? 0) > 0
    ? {
        statement: "<what this touch asks for, in one or two sentences>",
        relation: "tests",
        testsUncertainty: 1,
        customerPain: { status: "none_assumed" },
        evidenceSourceIds: [],
      }
    : {
        statement: "<what this touch asks for, in one or two sentences>",
        relation: "advances",
        customerPain: { status: "none_assumed" },
        evidenceSourceIds: [],
      };
}

/**
 * The composed writing execution contract.
 *
 * Identical Personality gate, source rules, lane gate, lineage step, and hard rules as the
 * Platform-native lane; what differs is the deliverable (a writing intent per touchpoint), the
 * absence of an unbound sketch lane, and an approval step that never mentions `auto_low_risk`.
 *
 * `target` is the *resolved* acting profile, not a config guess. When one is resolved, only its
 * platform's surfaces are offered — an X sample handed to a LinkedIn run is both wrong advice and
 * an intent `writingIntentDraftSchema` rejects.
 */
export function buildComposedWritingBriefSection(input: {
  composition: WritingIntentComposition;
  templateId: string;
  templateName: string;
  workflowRunId: string;
  signalsBaseUrl: string;
  target: { platform: string; targetId: string | null } | null;
  /** Dispatch-issued capability that mints this run's launch scope. */
  writingScopeToken?: string;
  /** The run's stamped account objective (#549); absent for runs dispatched before #549. */
  objective?: AccountObjective | null;
}): string {
  const objective = input.objective ?? null;
  const platform = input.target?.platform.toLowerCase() ?? null;
  const scoped = platform
    ? input.composition.surfaces.filter((surface) => surface.startsWith(`${platform}/`))
    : input.composition.surfaces;

  if (platform && scoped.length === 0) {
    return [
      "Shared writing-intent contract:",
      `Consumer: ${input.composition.consumer} (mandate=${input.composition.mandate})`,
      `Workflow run: ${input.workflowRunId}`,
      `No enabled writing surface exists for the acting platform ${platform}. Report every touchpoint as unsupported, propose nothing, and call complete_workflow_run with that blocker.`,
    ].join("\n");
  }

  const capabilityRows = buildWritingCapabilityRows(
    scoped.map((surface) => ({
      platform: surface.split("/")[0],
      surface,
      ...(input.target?.targetId && surface.startsWith(`${platform}/`)
        ? { targetId: input.target.targetId }
        : {}),
    })),
    "No surfaces configured — stop and ask the operator which surfaces this workflow may propose on.",
  );

  // Keep the sample internally valid: its surface and target platform always agree, because the
  // contract rejects a mismatch and an invalid sample teaches the agent the wrong shape.
  const sampleSurface = scoped[0];
  const samplePlatform = sampleSurface.split("/")[0];

  const intentTemplate = {
    schemaVersion: WRITING_INTENT_SCHEMA_VERSION,
    intentId: "wint_<generated>",
    mandate: "assist_only",
    actions: ["draft", "audit", "propose"],
    consumer: input.composition.consumer,
    lineage: {
      workflowRunId: input.workflowRunId,
      templateId: input.templateId,
      templateName: input.templateName,
    },
    recipient: { kind: "contact", contactId: "<contactId>", platform: "<recipient platform>", handle: "<handle>" },
    goal: { kind: "relationship_goal", id: "<relationshipGoal>", writingGoal: "<writingGoal>" },
    target: { platform: samplePlatform, targetId: input.target?.targetId ?? "<acting platform_targets.id>" },
    surface: sampleSurface,
    replyContext: { kind: "post", url: "<url of the post being answered>" },
    sourceRefs: [{ kind: "contact_record", contactId: "<contactId>" }],
    approvalPolicy: WRITING_INTENT_APPROVAL_POLICY,
    ...(objective
      ? {
          objective: { objectiveId: objective.objectiveId, hash: objective.hash },
          ask: sampleAsk(objective),
        }
      : {}),
  };

  return [
    "Shared writing-intent contract:",
    WRITING_SKILL_LOAD_STEP,
    `Consumer: ${input.composition.consumer} (mandate=${input.composition.mandate}, approvalPolicy=${input.composition.approvalPolicy})`,
    `Template: ${input.templateName} (${input.templateId})`,
    `Workflow run: ${input.workflowRunId}`,
    `Signals base URL: ${input.signalsBaseUrl}`,
    platform
      ? `Acting platform: ${platform}. Only the surfaces listed below are enabled for this run.`
      : "No acting target is configured. Resolve the acting profile per contact platform, then use only the surfaces below that match it.",
    "This workflow does not write its own voice, audit, approval, or lineage rules. It supplies intent; Signals owns the rest.",
    ...(objective ? buildAccountObjectiveBriefBlock(objective) : []),
    objective
      ? "Writing intent template — build one per touchpoint and attach it as `metadata.writing.intent` on upsert_variant. `objective` is copied exactly; `ask` is yours to fill in before drafting:"
      : "Writing intent template — build one per touchpoint and attach it as `metadata.writing.intent` on upsert_variant:",
    "```json",
    JSON.stringify(intentTemplate, null, 2),
    "```",
    "`surface` must belong to `target.platform`, and `lineage` must name this workflow run and template — Signals resolves the composition from the run record and rejects a mismatch.",
    "Capability truth:",
    ...capabilityRows,
    "Tool sequence:",
    WRITING_PERSONALITY_FILES_STEP,
    input.writingScopeToken
      ? `2. Create this run's launch with upsert_launch, passing \`writingScopeToken: "${input.writingScopeToken}"\`. That token was issued to this dispatch and is what binds the launch to it: Signals stamps a server-owned composition scope from the token, and every proposal on that launch is validated against the scope. Naming the run in \`writing.runs\` does not bind anything. A launch without the token cannot carry a proposal — do not share the token or reuse another run's. Then call get_writing_context with that launch and the intent surfaces, and treat its redactions and capability rows as authoritative.`
      : "2. No writing scope token was issued for this run, so no launch can be scoped to it and no proposal can be created. Report that and stop.",
    ...WRITING_SOURCE_STEPS,
    WRITING_LANE_GATE_STEP,
    buildWritingLaneBoundStep({
      deliverable: "draft one artifact per writing intent",
      extraContract: "the `metadata.writing.intent` record",
    }),
    "   - For `unbound`, refuse: a workflow proposal speaks as the workspace Personality, so there is no legacy-unbound sketch lane here. Report the persisted status and stop.",
    WRITING_LANE_DRIFTED_STEP,
    WRITING_LANE_REVISION_STEP,
    "   A proposal is bound to one recipient and goal. Rebinding an approved proposal to a different contact, relationship goal, or source set stales its audit and revokes approval — build a new intent instead.",
    WRITING_LINEAGE_STEP,
    "8. Render the persisted approval card after audit and precheck, then wait for fresh explicit user approval and call `materialize_variant` with the real user evidence. `auto_low_risk` does not apply to composed proposals — the mandate pins `explicit`, and Signals rejects a policy approval on these artifacts.",
    "   Never manufacture approval evidence. Use `revoke_variant_approval` when the user withdraws approval.",
    "9. Call complete_workflow_run with the variant/content IDs and any refused or blocked intents.",
    "Recipient boundary:",
    "- Workspace Personality answers \"who is speaking\". Contact data answers \"who is receiving and what is relevant\".",
    "- Read recipient context with get_contact; never copy contact facts, persona attributes, relationship notes, or private CRM fields into IDENTITY.md, SOUL.md, VOICE.md, or BRAND.md.",
    "- Only `sourceRefs` evidence may become a fact in the artifact; recipient context selects relevance, it does not create authority.",
    ...WRITING_HARD_RULES,
    `- Do not publish, send, comment, reply, schedule, or open a publish job from this workflow; ${input.composition.mandate} means draft, audit, and propose only.`,
  ].join("\n");
}
