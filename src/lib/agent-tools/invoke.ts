import { AGENT_TOOLS } from "@/lib/agent-tools/registry";
import { AgentToolError } from "@/lib/agent-tools/types";
import { getImmutableBirthFieldsError } from "@/lib/api/contact-route-validation";

export const CONTACT_IMPORT_TOOL_NAMES = [
  "query_contacts",
  "resolve_platform_claim",
  "create_contact",
  "enrich_contact",
  "upsert_contact_identity",
  "record_workflow_run_contacts",
] as const;

const CONTACT_IMPORT_TOOLS = new Set<string>(CONTACT_IMPORT_TOOL_NAMES);

function hasLegacyErrorResult(result: unknown): result is { error: unknown } {
  return (
    typeof result === "object" &&
    result !== null &&
    !Array.isArray(result) &&
    Object.prototype.hasOwnProperty.call(result, "error")
  );
}

export async function invokeAgentTool(tool: string, input: unknown) {
  const definition = AGENT_TOOLS[tool];
  if (!definition) {
    throw new AgentToolError("TOOL_NOT_FOUND", `Unknown tool: ${tool}`);
  }

  if (tool === "update_contact") {
    const birthError = getImmutableBirthFieldsError(input);
    if (birthError) {
      throw new AgentToolError("VALIDATION_ERROR", birthError);
    }
  }

  const parsed = definition.schema.safeParse(input ?? {});
  if (!parsed.success) {
    throw new AgentToolError("VALIDATION_ERROR", "Invalid tool input", parsed.error.flatten());
  }

  try {
    const result = await definition.execute(parsed.data);
    if (CONTACT_IMPORT_TOOLS.has(tool) && hasLegacyErrorResult(result)) {
      const message =
        typeof result.error === "string" && result.error.trim()
          ? result.error
          : `${tool} returned an invalid legacy error result`;
      throw new AgentToolError("EXECUTION_ERROR", message, { tool });
    }
    return result;
  } catch (error) {
    if (error instanceof AgentToolError) {
      throw error;
    }
    const message = error instanceof Error ? error.message : "Tool execution failed";
    throw new AgentToolError("EXECUTION_ERROR", message, error);
  }
}
