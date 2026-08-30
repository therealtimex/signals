import type { WorkflowTemplate } from "@/lib/db/types";
import { parseTemplateConfig } from "@/lib/workflows/template-config";
import {
  buildSocialPatrolBriefSection,
  isSocialPatrolTemplateConfig,
  stripRetiredSocialPatrolConfigKeys,
} from "@/lib/workflows/social-patrol";
import {
  buildProfilePublishBriefSection,
  isProfilePublishTemplateConfig,
} from "@/lib/workflows/profile-publish";
import {
  buildContactNurtureBriefSection,
  isContactNurtureTemplateConfig,
} from "@/lib/workflows/contact-relationship-nurture";
import {
  buildNetworkSnowballBriefSection,
  isNetworkSnowballTemplateConfig,
} from "@/lib/workflows/network-snowball";
import { WORKFLOW_TERMINAL_TEARDOWN_AFTER_COMPLETE } from "@/lib/rtx/teardown";
import {
  buildWritingBriefSection,
  isSignalsWritingTemplateConfig,
} from "@/lib/workflows/signals-writing";
import {
  CONTACT_WEB_RESEARCH_THREAD_NAME,
  CONTACT_WEB_RESEARCH_TOOLS,
  buildContactWebResearchBriefSection,
  isContactWebResearchTemplateConfig,
  type ContactWebResearchBriefContext,
} from "@/lib/workflows/contact-web-research";

const CATEGORY_LABELS: Record<string, string> = {
  prospecting: "Search",
  enrichment: "Enrich",
  pruning: "Prune",
  content: "Content",
  engagement: "Engage",
  outreach: "Outreach",
  nurture: "Nurture",
};

const TOOLS_BY_TYPE: Record<string, string[]> = {
  prospecting: ["query_contacts", "enrich_contact", "create_task"],
  enrichment: ["query_contacts", "enrich_contact"],
  pruning: ["query_contacts", "find_duplicate_contacts", "merge_contacts", "create_task"],
  content: [
    "query_content",
    "get_content",
    "query_graph",
    "get_writing_context",
    "list_voice_profiles",
    "get_voice_profile",
    "upsert_voice_profile",
    "approve_voice_profile",
    "upsert_launch",
    "upsert_variant",
    "materialize_variant",
    "revoke_variant_approval",
    "create_content_draft",
    "update_content_draft",
    "create_task",
    "complete_workflow_run",
  ],
  engagement: ["query_contacts", "create_task"],
  outreach: ["query_contacts", "create_task"],
  nurture: ["query_contacts", "get_contact", "update_contact", "query_goals", "create_task"],
};

export function getTemplateToolsHint(
  templateType: string,
  config?: Record<string, unknown>,
): string[] {
  if (config && isContactWebResearchTemplateConfig(config)) {
    return [...CONTACT_WEB_RESEARCH_TOOLS];
  }
  return TOOLS_BY_TYPE[templateType] ?? ["query_contacts", "create_task"];
}

/**
 * Name of a template's dedicated RealTimeX thread.
 *
 * One thread per template, so the sidebar reads as the template list — no `agent:` /
 * `pipeline:` prefix and no `(2)`, `(3)` run suffixes to disambiguate.
 */
/**
 * `Run #N — ` prefix for messages posted into a template's shared thread.
 *
 * Runs of one template interleave in a single timeline (a scheduled drain batch can
 * overlap a manual run), so every appended message carries its ordinal.
 */
export function formatRunLabelPrefix(runNumber?: number): string {
  return runNumber && runNumber > 0 ? `Run #${runNumber} — ` : "";
}

export function buildTemplateThreadName(templateName: string): string {
  return templateName.trim().slice(0, 60) || "Workflow";
}

export function resolveTemplateThreadName(
  template: Pick<WorkflowTemplate, "name" | "config">,
): string {
  return isContactWebResearchTemplateConfig(parseTemplateConfig(template.config))
    ? CONTACT_WEB_RESEARCH_THREAD_NAME
    : buildTemplateThreadName(template.name);
}

/**
 * Drop seed bookkeeping (`_seedVersion`) before the config reaches an agent — it is a
 * migration marker, and an agent reading it as a run control is pure noise.
 *
 * Retired template keys go the same way. The seed migration only rewrites system templates, so a
 * clone made before a key was retired still carries it, and the runtime block is exactly where an
 * agent would read it as a live budget.
 */
function stripInternalConfigKeys(config: Record<string, unknown>): Record<string, unknown> {
  const visible = Object.fromEntries(
    Object.entries(config).filter(([key]) => !key.startsWith("_"))
  );
  return isSocialPatrolTemplateConfig(visible)
    ? stripRetiredSocialPatrolConfigKeys(visible) ?? visible
    : visible;
}

export function buildAgentWorkflowBrief(input: {
  template: Pick<
    WorkflowTemplate,
    "id" | "name" | "description" | "templateType" | "platform" | "systemPrompt" | "targetPersona"
  >;
  workflowRunId: string;
  config: Record<string, unknown>;
  signalsBaseUrl: string;
  systemPromptOverride?: string;
  contactWebResearchContext?: ContactWebResearchBriefContext;
}): string {
  const category = CATEGORY_LABELS[input.template.templateType] ?? input.template.templateType;
  const instructions = input.systemPromptOverride?.trim() || input.template.systemPrompt?.trim();
  const tools = getTemplateToolsHint(input.template.templateType, input.config).join(", ");
  const configJson = JSON.stringify(stripInternalConfigKeys(input.config), null, 2);
  const patrolContract = isSocialPatrolTemplateConfig(input.config)
    ? `${buildSocialPatrolBriefSection({
        workflowRunId: input.workflowRunId,
        templateId: input.template.id,
        config: input.config,
      })}\n`
    : null;
  const publishContract = isProfilePublishTemplateConfig(input.config)
    ? `${buildProfilePublishBriefSection({
        workflowRunId: input.workflowRunId,
        config: input.config,
        signalsBaseUrl: input.signalsBaseUrl,
      })}\n`
    : null;
  const nurtureContract = isContactNurtureTemplateConfig(input.config)
    ? `${buildContactNurtureBriefSection({
        workflowRunId: input.workflowRunId,
        config: input.config,
        signalsBaseUrl: input.signalsBaseUrl,
      })}\n`
    : null;
  const snowballContract = isNetworkSnowballTemplateConfig(input.config)
    ? `${buildNetworkSnowballBriefSection({
        workflowRunId: input.workflowRunId,
        templateId: input.template.id,
        config: input.config,
        signalsBaseUrl: input.signalsBaseUrl,
      })}\n`
    : null;
  const writingContract = isSignalsWritingTemplateConfig(input.config)
    ? `${buildWritingBriefSection({
        template: input.template,
        config: input.config,
        workflowRunId: input.workflowRunId,
        signalsBaseUrl: input.signalsBaseUrl,
      })}\n`
    : null;
  const contactWebResearchContract =
    isContactWebResearchTemplateConfig(input.config) && input.contactWebResearchContext
      ? `${buildContactWebResearchBriefSection({
          workflowRunId: input.workflowRunId,
          config: input.config,
          signalsBaseUrl: input.signalsBaseUrl,
          context: input.contactWebResearchContext,
        })}\n`
      : null;

  const sections = [
    `You are executing the Signals agent workflow template "${input.template.name}".`,
    "",
    `Workflow run: ${input.workflowRunId}`,
    `Template ID: ${input.template.id}`,
    `Category: ${category}`,
    input.template.platform ? `Platform: ${input.template.platform}` : null,
    input.template.description ? `Goal: ${input.template.description}` : null,
    input.template.targetPersona ? `Audience / scope: ${input.template.targetPersona}` : null,
    "",
    "Workspace context:",
    "- Personality & guidelines: Follow `AGENTS.md` for workspace operating model, skill checklist, and privacy rules.",
    "- Workspace skills available: `realtimex-signals`, `signals-writing`, `signals-publish`, `agent-browser`.",
    "",
    instructions ? `Instructions:\n${instructions}` : null,
    "",
    "Runtime config (override with run options):",
    "```json",
    configJson,
    "```",
    "",
    "Environment setup:",
    "```bash",
    `# 1. Export base URL for CLI tools in this session:`,
    `export SIGNALS_BASE_URL="${input.signalsBaseUrl}"`,
    "",
    `# 2. Verify health and pin CLI version from Local App (expect app=signals, status=ok, cliVersion):`,
    `.claude/skills/realtimex-signals/scripts/run-signals-pp-cli.sh health`,
    "",
    `# Or: npx --yes @realtimex/signals-pp-cli@"$(curl -sf ${input.signalsBaseUrl}/api/health | jq -r .cliVersion)" health`,
    "```",
    "",
    "Execution requirements:",
    "1. Signals is already running — do not start or manage Local Apps via pp-cli.",
    `2. Verify health before bulk write-back: .claude/skills/realtimex-signals/scripts/run-signals-pp-cli.sh health (or curl -s ${input.signalsBaseUrl}/api/health — expect app=signals, status=ok, cliVersion).`,
    "3. BULK INGESTION REQUIREMENT: After staging workflow-runs/<runId>/contacts.csv (or contacts.json), commit CRM rows with:",
    `   .claude/skills/realtimex-signals/scripts/run-signals-pp-cli.sh import contacts --file workflow-runs/${input.workflowRunId}/contacts.csv --dedupe --workflow-run-id ${input.workflowRunId} --template-id ${input.template.id}`,
    "4. Do NOT call create_contact in a loop for bulk mining — the CLI import performs deduplication, platform claim validation, and rate-limit buffering.",
    "5. Prefer run-signals-pp-cli.sh (health-pinned npx) over bare signals-pp-cli on PATH or bash invoke-tool.sh wrappers.",
    "6. When you create contacts or orgs via agent-tools, pass `workflowRunId` and `templateId` from this brief so Signals can attribute them to this run.",
    `7. Discover tools: GET ${input.signalsBaseUrl}/api/agent-tools`,
    `8. For single-record edits, invoke tools (${tools}) via POST ${input.signalsBaseUrl}/api/agent-tools/invoke with JSON { \"tool\": \"...\", \"input\": { ... } }.`,
    "9. Perform web search and browser work in RealTimeX (not via agent-tools).",
    `10. FINALIZATION: When finished, call complete_workflow_run via POST ${input.signalsBaseUrl}/api/agent-tools/invoke with { "tool": "complete_workflow_run", "input": { "runId": "${input.workflowRunId}", "status": "completed", "summary": "..." } } to trigger automated follow-on cascades and webhook dispatch.`,
    `11. TEARDOWN & RESOURCE RELEASE: ${WORKFLOW_TERMINAL_TEARDOWN_AFTER_COMPLETE}`,
    "",
    patrolContract,
    publishContract,
    nurtureContract,
    snowballContract,
    writingContract,
    contactWebResearchContract,
    "Do not call legacy in-process workflow runners. This thread is the execution lane.",
  ];

  return sections.filter((line) => line !== null).join("\n");
}

export function mergeRunConfig(
  template: Pick<WorkflowTemplate, "config">,
  overrides?: Record<string, unknown>
): Record<string, unknown> {
  return {
    ...parseTemplateConfig(template.config),
    ...(overrides ?? {}),
  };
}
