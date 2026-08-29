import type { z } from "zod";

export type AgentToolCategory =
  | "contacts"
  | "goals"
  | "content"
  | "workflows"
  | "analytics"
  | "tasks"
  | "graph"
  | "platforms";

export type AgentToolDefinition<T extends z.ZodTypeAny = z.ZodTypeAny> = {
  name: string;
  description: string;
  category: AgentToolCategory;
  parameters: Record<string, unknown>;
  schema: T;
  execute: (input: z.infer<T>) => Promise<unknown>;
};

export type AgentToolErrorCode =
  | "TOOL_NOT_FOUND"
  | "VALIDATION_ERROR"
  | "NOT_FOUND"
  | "CONFLICT"
  | "AUDIT_STALE"
  | "AUDIT_BLOCKED"
  | "APPROVAL_REQUIRED"
  | "CAPABILITY_UNSUPPORTED"
  | "TARGET_REQUIRED"
  | "STORE_BUSY"
  | "STORE_CONFLICT"
  | "EXECUTION_ERROR";

export class AgentToolError extends Error {
  constructor(
    public readonly code: AgentToolErrorCode,
    message: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = "AgentToolError";
  }
}
