import type { z } from "zod";

export type AgentToolCategory =
  | "contacts"
  | "goals"
  | "content"
  | "workflows"
  | "analytics"
  | "tasks"
  | "graph";

export type AgentToolDefinition<T extends z.ZodTypeAny = z.ZodTypeAny> = {
  name: string;
  description: string;
  category: AgentToolCategory;
  parameters: Record<string, unknown>;
  schema: T;
  execute: (input: z.infer<T>) => Promise<unknown>;
};

export class AgentToolError extends Error {
  constructor(
    public readonly code: "TOOL_NOT_FOUND" | "VALIDATION_ERROR" | "EXECUTION_ERROR",
    message: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = "AgentToolError";
  }
}
