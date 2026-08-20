import type { WorkflowTemplate } from "@/lib/db/types";
import { parseTemplateConfig } from "@/lib/workflows/template-config";
import {
  buildSocialPatrolBriefSection,
  isSocialPatrolTemplateConfig,
} from "@/lib/workflows/social-patrol";

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
  content: ["query_content", "create_task"],
  engagement: ["query_contacts", "create_task"],
  outreach: ["query_contacts", "create_task"],
  nurture: ["query_contacts", "query_goals", "create_task"],
};

export function getTemplateToolsHint(templateType: string): string[] {
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

/**
 * Drop seed bookkeeping (`_seedVersion`) before the config reaches an agent — it is a
 * migration marker, and an agent reading it as a run control is pure noise.
 */
function stripInternalConfigKeys(config: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(config).filter(([key]) => !key.startsWith("_"))
  );
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
}): string {
  const category = CATEGORY_LABELS[input.template.templateType] ?? input.template.templateType;
  const instructions = input.systemPromptOverride?.trim() || input.template.systemPrompt?.trim();
  const tools = getTemplateToolsHint(input.template.templateType).join(", ");
  const configJson = JSON.stringify(stripInternalConfigKeys(input.config), null, 2);
  const patrolContract = isSocialPatrolTemplateConfig(input.config)
    ? `${buildSocialPatrolBriefSection({
        workflowRunId: input.workflowRunId,
        config: input.config,
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
    "Instructions for your RealTimeX agent:",
    instructions || "(No custom instructions — follow the category defaults below.)",
    "",
    "Runtime config:",
    "```json",
    configJson,
    "```",
    "",
    `Signals base URL: ${input.signalsBaseUrl}`,
    "",
    "Execution requirements:",
    "1. Signals is already running — do not start or manage Local Apps via pp-cli.",
    `2. Verify health before bulk write-back: signals-pp-cli health (or curl -s ${input.signalsBaseUrl}/api/health — expect app=signals, status=ok).`,
    "3. After staging workflow-runs/<runId>/contacts.csv (or contacts.json), commit CRM rows with:",
    `   signals-pp-cli import contacts --file workflow-runs/${input.workflowRunId}/contacts.csv --dedupe`,
    "4. Do not loop create_contact manually for bulk imports.",
    "5. Prefer signals-pp-cli over bash invoke-tool.sh wrappers when the bundled CLI is on PATH.",
    "6. When you create contacts or orgs via agent-tools, pass `workflowRunId` and `templateId` from this brief so Signals can attribute them to this run.",
    `7. Discover tools: GET ${input.signalsBaseUrl}/api/agent-tools`,
    `8. For single-record edits, invoke tools (${tools}) via POST ${input.signalsBaseUrl}/api/agent-tools/invoke with JSON { \"tool\": \"...\", \"input\": { ... } }.`,
    "9. Perform web search and browser work in RealTimeX (not via agent-tools).",
    "10. Report a concise summary in this thread when finished (import JSON summary is suitable).",
    "",
    patrolContract,
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
