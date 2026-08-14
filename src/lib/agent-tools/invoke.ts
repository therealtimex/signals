import { AGENT_TOOLS } from "@/lib/agent-tools/registry";
import { AgentToolError } from "@/lib/agent-tools/types";

export async function invokeAgentTool(tool: string, input: unknown) {
  const definition = AGENT_TOOLS[tool];
  if (!definition) {
    throw new AgentToolError("TOOL_NOT_FOUND", `Unknown tool: ${tool}`);
  }

  const parsed = definition.schema.safeParse(input ?? {});
  if (!parsed.success) {
    throw new AgentToolError("VALIDATION_ERROR", "Invalid tool input", parsed.error.flatten());
  }

  try {
    const result = await definition.execute(parsed.data);
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Tool execution failed";
    throw new AgentToolError("EXECUTION_ERROR", message, error);
  }
}
