import type { z } from "zod";
import { completeSimulationRunObjectSchema } from "@/lib/agent-tools/graph-schemas";

/** Minimal Zod 3 → JSON Schema for agent tool manifests. */
export function zodToParameters(schema: z.ZodTypeAny): Record<string, unknown> {
  return convert(schema);
}

/** Manifest parameters for complete_simulation_run with status-conditional required fields. */
export function completeSimulationRunParameters(): Record<string, unknown> {
  const base = convert(completeSimulationRunObjectSchema);
  return {
    ...base,
    allOf: [
      {
        if: {
          anyOf: [
            { not: { required: ["status"] } },
            {
              properties: { status: { const: "completed" } },
              required: ["status"],
            },
          ],
        },
        then: {
          required: ["predictedScore", "predictionConfidence", "predictedMetrics"],
        },
      },
      {
        if: {
          properties: { status: { const: "failed" } },
          required: ["status"],
        },
        then: {
          required: ["error"],
        },
      },
    ],
  };
}

function convert(schema: z.ZodTypeAny): Record<string, unknown> {
  const def = schema._def as {
    typeName?: string;
    innerType?: z.ZodTypeAny;
    type?: z.ZodTypeAny;
    schema?: z.ZodTypeAny;
    value?: unknown;
    values?: unknown[];
    shape?: () => Record<string, z.ZodTypeAny>;
    valueType?: z.ZodTypeAny;
    keyType?: z.ZodTypeAny;
    description?: string;
  };

  switch (def.typeName) {
    case "ZodOptional":
    case "ZodNullable":
      return convert(def.innerType!);
    case "ZodDefault":
      return convert(def.innerType!);
    case "ZodObject": {
      const shape = def.shape?.() ?? {};
      const properties: Record<string, unknown> = {};
      const required: string[] = [];

      for (const [key, value] of Object.entries(shape)) {
        properties[key] = convert(value);
        if (!value.isOptional()) {
          required.push(key);
        }
      }

      return {
        type: "object",
        properties,
        ...(required.length > 0 ? { required } : {}),
        additionalProperties: false,
      };
    }
    case "ZodString":
      return { type: "string", ...(def.description ? { description: def.description } : {}) };
    case "ZodNumber":
      return { type: "number", ...(def.description ? { description: def.description } : {}) };
    case "ZodBoolean":
      return { type: "boolean", ...(def.description ? { description: def.description } : {}) };
    case "ZodArray":
      return {
        type: "array",
        items: convert(def.type!),
        ...(def.description ? { description: def.description } : {}),
      };
    case "ZodRecord":
      return {
        type: "object",
        additionalProperties: convert(def.valueType!),
        ...(def.description ? { description: def.description } : {}),
      };
    case "ZodEnum":
      return {
        type: "string",
        enum: def.values,
        ...(def.description ? { description: def.description } : {}),
      };
    case "ZodLiteral":
      return { const: def.value };
    case "ZodUnion": {
      const options = (schema as z.ZodUnion<[z.ZodTypeAny, ...z.ZodTypeAny[]]>)._def.options;
      const literals = options.filter((o) => o._def.typeName === "ZodLiteral");
      if (literals.length === options.length) {
        return {
          type: "string",
          enum: literals.map((o) => (o._def as { value: unknown }).value),
        };
      }
      return { description: "union" };
    }
    case "ZodEffects":
      return convert(def.schema!);
    default:
      return { type: "object" };
  }
}
