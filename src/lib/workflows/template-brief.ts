import type { WorkflowTemplate } from "@/lib/db/types";
import { parseTemplateConfig } from "@/lib/workflows/template-config";

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
  pruning: ["query_contacts", "create_task"],
  content: ["query_content", "create_task"],
  engagement: ["query_contacts", "create_task"],
  outreach: ["query_contacts", "create_task"],
  nurture: ["query_contacts", "query_goals", "create_task"],
};

export function getTemplateToolsHint(templateType: string): string[] {
  return TOOLS_BY_TYPE[templateType] ?? ["query_contacts", "create_task"];
}

export function buildAgentWorkflowThreadName(templateName: string): string {
  const label = templateName.trim().slice(0, 60) || "Agent";
  return `agent: ${label}`;
}

/** Audit/status threads for in-process pipelines — not terminal-agent work orders. */
export function buildPipelineThreadName(templateName: string): string {
  const label = templateName.trim().slice(0, 60) || "Pipeline";
  return `pipeline: ${label}`;
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
  const configJson = JSON.stringify(input.config, null, 2);

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
    `2. Verify the base URL: curl -s ${input.signalsBaseUrl}/api/health (expect app=signals).`,
    "3. If workspace skill scripts exist, you may run `.claude/skills/realtimex-signals/scripts/resolve-base-url.sh` to double-check the base URL; otherwise use the URL above directly.",
    `4. Discover tools: GET ${input.signalsBaseUrl}/api/agent-tools`,
    `5. Invoke tools (${tools}) via POST ${input.signalsBaseUrl}/api/agent-tools/invoke with JSON { "tool": "...", "input": { ... } }.`,
    "6. Perform web search and browser work in RealTimeX (not via agent-tools).",
    "7. Write structured results back to Signals through agent-tools.",
    "8. Report a concise summary in this thread when finished.",
    "",
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
