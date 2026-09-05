import { describe, expect, it } from "vitest";
import { z } from "zod";
import { zodToParameters } from "@/lib/agent-tools/json-schema";
import { createContactSchema } from "@/lib/agent-tools/schemas";

describe("zodToParameters", () => {
  it("keeps a description declared on the optional wrapper", () => {
    const params = zodToParameters(
      z.object({ note: z.string().optional().describe("why this field matters") }),
    ) as { properties: Record<string, { description?: string }> };

    expect(params.properties.note.description).toBe("why this field matters");
  });

  it("keeps descriptions through nullable and default wrappers", () => {
    const params = zodToParameters(
      z.object({
        a: z.string().nullable().describe("nullable note"),
        b: z.number().default(1).describe("default note"),
      }),
    ) as { properties: Record<string, { description?: string }> };

    expect(params.properties.a.description).toBe("nullable note");
    expect(params.properties.b.description).toBe("default note");
  });

  it("still prefers an inner description when the wrapper has none", () => {
    const params = zodToParameters(
      z.object({ note: z.string().describe("inner note").optional() }),
    ) as { properties: Record<string, { description?: string }> };

    expect(params.properties.note.description).toBe("inner note");
  });

  it("exposes avatar guidance on create_contact so agents stop omitting it", () => {
    const params = zodToParameters(createContactSchema) as {
      properties: Record<string, { description?: string }>;
    };

    expect(params.properties.avatarUrl.description).toContain("unavatar.io/linkedin/company:");
  });
});
