import type { WorkflowCompletedEventPayload } from "@/lib/webhooks/workflow-events";
import { resolveSignalsBaseUrlFromEnv } from "@/lib/rtx/resolve-signals-base-url";
import { writeRtxWorkspaceBriefFile, orchestratorEventBriefRelativePath } from "@/lib/rtx/workspace-brief-files";
import type { EnvLike } from "@/lib/rtx/env";

export interface BuildOrchestratorBriefOptions {
  eventPayload: WorkflowCompletedEventPayload;
  routingRecommendation?: {
    suggestedAction: "nurture" | "patrol" | "profile_pipeline" | "review";
    rationale: string;
  };
  signalsBaseUrl?: string;
}

/**
 * Builds a structured Markdown brief for the Signals Orchestrator agent.
 */
export function buildOrchestratorBriefMarkdown(options: BuildOrchestratorBriefOptions): string {
  const { eventPayload, routingRecommendation } = options;
  const baseUrl = options.signalsBaseUrl || resolveSignalsBaseUrlFromEnv() || "http://localhost:3010";

  const suggestedAction = routingRecommendation?.suggestedAction || "review";
  const rationale =
    routingRecommendation?.rationale ||
    "Review the cohort metrics and determine appropriate follow-on nurture or research actions.";

  const contactList = eventPayload.createdContactIds && eventPayload.createdContactIds.length > 0
    ? eventPayload.createdContactIds.map((id) => `- \`${id}\``).join("\n")
    : "- (No direct contact IDs attached)";

  const followOnActions = eventPayload.cascadeConfig?.followOnActions ?? [];
  const followOnList = followOnActions.length > 0
    ? followOnActions.map((a) => `- \`${a}\``).join("\n")
    : "- `agentic_router`";

  const targetThreadName = eventPayload.targetThread?.name ?? "Signals Orchestrator";
  const targetThreadSlug = eventPayload.targetThread?.slug ?? "signals-orchestrator";
  const cascadePolicy = eventPayload.cascadeConfig?.cascadePolicy ?? "immediate";
  const cohortSize = eventPayload.createdContactIds ? eventPayload.createdContactIds.length : 0;

  const lines = [
    `# Signals Orchestrator Handoff Brief`,
    "",
    `You are the Signals GTM Orchestrator terminal agent handling a \`${eventPayload.event}\` workflow event.`,
    "",
    "## Event Metadata",
    `- **Event:** \`${eventPayload.event}\``,
    `- **Run ID:** \`${eventPayload.runId}\``,
    `- **Source Template:** ${eventPayload.templateName} (\`${eventPayload.templateId || "system"}\`)`,
    `- **Category:** \`${eventPayload.templateType}\``,
    `- **Status:** \`${eventPayload.status}\``,
    `- **Total Processed:** ${eventPayload.totalProcessed}`,
    `- **Completed At:** ${new Date(eventPayload.timestamp * 1000).toISOString()}`,
    `- **Target Thread:** ${targetThreadName} (\`${targetThreadSlug}\`)`,
    "",
    "## Discovered Cohort Summary",
    `- **Summary:** ${eventPayload.summary}`,
    `- **Cohort Size:** ${cohortSize} contact(s)`,
    "",
    "### Contact IDs in Cohort",
    contactList,
    "",
    "## Orchestration & Routing Recommendation",
    `- **Recommended Next Action:** \`${suggestedAction}\``,
    `- **Rationale:** ${rationale}`,
    `- **Cascade Policy:** \`${cascadePolicy}\``,
    `- **Configured Follow-on Pipeline:**`,
    followOnList,
    "",
    "## Environment Setup",
    "```bash",
    `# Export base URL for CLI tools in this session:`,
    `export SIGNALS_BASE_URL="${baseUrl}"`,
    "",
    `# Verify Signals Local App health:`,
    `signals-pp-cli health`,
    "```",
    "",
    "## Execution Instructions",
    `1. Review the cohort analysis and recommendation above.`,
    `2. If cascade policy is immediate (or operator approves): dispatch the recommended workflow:`,
    `   - For Profile Pipeline: call agent tool \`start_workflow\` or \`dispatch_follow_on_workflow\` with template "Contact profile pipeline" and target contact IDs.`,
    `   - For Contact Nurture: call agent tool \`dispatch_follow_on_workflow\` with action "contact_nurture".`,
    `   - For Social Patrol: call agent tool \`start_workflow\` with template "Social Intent Patrol".`,
    `3. To invoke tools via REST:`,
    `   POST ${baseUrl}/api/agent-tools/invoke with JSON:`,
    `   \`{ "tool": "dispatch_follow_on_workflow", "input": { "parentRunId": "${eventPayload.runId}", "overrideAction": "${suggestedAction === "patrol" ? "social_patrol" : suggestedAction === "nurture" ? "contact_nurture" : "profile_pipeline"}" } }\``,
    `4. Report a concise summary in this thread describing the follow-on workflows triggered.`,
    `5. TEARDOWN & RESOURCE RELEASE PROTOCOL: When the handoff or dispatch is completed, terminate all spawned browser sessions and exit cleanly (\`process.exit(0)\`) to immediately release RAM and CPU resources in RealTimeX.`,
  ];

  return lines.join("\n");
}

/**
 * Writes the orchestrator brief file to the RealTimeX workspace storage.
 */
export async function writeOrchestratorBriefFile(
  workspaceSlug: string,
  runId: string,
  content: string,
  env: EnvLike = process.env
) {
  const relativePath = orchestratorEventBriefRelativePath(runId);
  return writeRtxWorkspaceBriefFile(workspaceSlug, relativePath, content, env);
}
