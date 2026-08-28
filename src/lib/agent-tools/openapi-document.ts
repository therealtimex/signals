import { listAgentToolsManifest } from "@/lib/agent-tools/registry";

const INVOKE_SUCCESS = {
  type: "object",
  properties: {
    success: { const: true },
    tool: { type: "string" },
    result: {},
  },
  required: ["success", "tool", "result"],
  additionalProperties: true,
} as const;

const INVOKE_ERROR = {
  type: "object",
  properties: {
    success: { const: false },
    error: { type: "string" },
    code: { type: "string" },
    details: {},
  },
  required: ["success", "error", "code"],
  additionalProperties: true,
} as const;

const HEALTH_RESPONSE = {
  type: "object",
  properties: {
    status: { type: "string", enum: ["ok"] },
    app: { type: "string", enum: ["signals"] },
    cliPackage: { type: "string" },
    cliVersion: { type: "string" },
    rtx: { type: "object", additionalProperties: true },
  },
  required: ["status", "app", "cliPackage", "cliVersion"],
  additionalProperties: true,
} as const;

/**
 * OpenAPI 3.1 document for CLI Printing Press — agent-tools surface only.
 * Source of truth: agent-tools registry (same as GET /api/agent-tools).
 */
export function buildAgentToolsOpenApiDocument(baseUrl = "http://127.0.0.1:3000") {
  const manifest = listAgentToolsManifest();
  const toolNames = manifest.tools.map((tool) => tool.name);

  const invokeRequestProperties: Record<string, unknown> = {
    tool: {
      type: "string",
      enum: toolNames,
      description: "Agent tool name from the manifest",
    },
    input: {
      type: "object",
      description: "Tool-specific input payload",
      additionalProperties: true,
    },
  };

  const invokeRequestOneOf = manifest.tools.map((tool) => ({
    type: "object",
    properties: {
      tool: { const: tool.name },
      input: tool.parameters,
    },
    required: ["tool"],
    additionalProperties: false,
  }));

  return {
    openapi: "3.1.0",
    info: {
      title: "Signals Agent Tools",
      version: manifest.version,
      description:
        "Local Signals CRM agent-tools API. Generated from src/lib/agent-tools/registry.ts.",
    },
    servers: [{ url: baseUrl }],
    paths: {
      "/api/health": {
        get: {
          operationId: "getHealth",
          summary: "Signals health probe",
          responses: {
            "200": {
              description: "Signals is running",
              content: {
                "application/json": {
                  schema: HEALTH_RESPONSE,
                },
              },
            },
          },
        },
      },
      "/api/agent-tools": {
        get: {
          operationId: "listAgentTools",
          summary: "List agent tool manifest",
          responses: {
            "200": {
              description: "Tool manifest",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      version: { type: "string" },
                      tools: {
                        type: "array",
                        items: {
                          type: "object",
                          properties: {
                            name: { type: "string" },
                            description: { type: "string" },
                            category: { type: "string" },
                            parameters: { type: "object", additionalProperties: true },
                          },
                          required: ["name", "description", "category", "parameters"],
                          additionalProperties: false,
                        },
                      },
                    },
                    required: ["version", "tools"],
                    additionalProperties: false,
                  },
                },
              },
            },
          },
        },
      },
      "/api/agent-tools/invoke": {
        post: {
          operationId: "invokeAgentTool",
          summary: "Invoke an agent tool",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  oneOf: invokeRequestOneOf,
                  properties: invokeRequestProperties,
                  required: ["tool"],
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Tool result",
              content: {
                "application/json": {
                  schema: INVOKE_SUCCESS,
                },
              },
            },
            "400": {
              description: "Validation error",
              content: {
                "application/json": {
                  schema: INVOKE_ERROR,
                },
              },
            },
            "404": {
              description: "Tool not found",
              content: {
                "application/json": {
                  schema: INVOKE_ERROR,
                },
              },
            },
            "500": {
              description: "Execution error",
              content: {
                "application/json": {
                  schema: INVOKE_ERROR,
                },
              },
            },
          },
        },
      },
    },
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          description: "Optional SIGNALS_AGENT_TOOL_TOKEN for non-localhost access",
        },
      },
    },
    security: [{ bearerAuth: [] }],
    "x-signals-agent-tools": {
      manifestVersion: manifest.version,
      toolCount: manifest.tools.length,
    },
  };
}
