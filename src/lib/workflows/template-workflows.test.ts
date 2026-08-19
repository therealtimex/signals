import { describe, expect, it } from "vitest";
import {
  buildTemplateConfig,
  extractLimitsFromConfig,
  parseTemplateConfig,
} from "@/lib/workflows/template-config";
import { buildAgentWorkflowBrief, getTemplateToolsHint } from "@/lib/workflows/template-brief";
import { serializeTemplateForUi } from "@/lib/workflows/template-serializer";

describe("template-config", () => {
  it("builds prospecting limits into config JSON", () => {
    const config = buildTemplateConfig("prospecting", { maxResults: 15 });
    expect(parseTemplateConfig(config)).toEqual({ maxResults: 15 });
  });

  it("replaces stale limit keys when category changes", () => {
    const config = buildTemplateConfig(
      "content",
      { topics: ["AI"], tone: "casual" },
      JSON.stringify({ maxResults: 20, topics: ["old"], tone: "formal" })
    );
    expect(parseTemplateConfig(config)).toEqual({
      topics: ["AI"],
      tone: "casual",
    });
  });

  it("extracts enrichment limits from stored config", () => {
    const limits = extractLimitsFromConfig(
      "enrichment",
      JSON.stringify({ maxContacts: 5, maxEnrichmentScore: 40 })
    );
    expect(limits).toEqual({ maxContacts: 5, maxEnrichmentScore: 40 });
  });
});

describe("template-brief", () => {
  it("includes instructions and tools in the launch brief", () => {
    const brief = buildAgentWorkflowBrief({
      template: {
        id: "tpl_1",
        name: "Founder Search",
        description: "Find AI founders",
        templateType: "prospecting",
        platform: "x",
        systemPrompt: "Search X for founders.",
        targetPersona: "AI founders",
      },
      workflowRunId: "run_1",
      config: { maxResults: 10 },
      signalsBaseUrl: "http://localhost:3000",
    });

    expect(brief).toContain("Founder Search");
    expect(brief).toContain("Search X for founders.");
    expect(brief).toContain(getTemplateToolsHint("prospecting").join(", "));
    expect(brief).toContain("signals-pp-cli import contacts");
    expect(brief).toContain("workflow-runs/run_1/contacts.csv");
    expect(brief).toContain("signals-pp-cli health");
    expect(brief).toContain("http://localhost:3000/api/agent-tools");
    expect(brief).toContain("do not start or manage Local Apps via pp-cli");
    expect(brief).not.toContain("Load the `realtimex-signals` skill");
  });
});

describe("template-serializer", () => {
  it("strips estimatedCost from API payloads", () => {
    const serialized = serializeTemplateForUi({
      id: "tpl_1",
      name: "Test",
      description: null,
      platform: null,
      templateType: "prospecting",
      status: "active",
      config: "{}",
      goalMetrics: null,
      startsAt: null,
      endsAt: null,
      systemPrompt: null,
      targetPersona: null,
      estimatedCost: 0.5,
      totalRuns: 0,
      lastRunAt: null,
      isSystem: 1,
      sourceTemplateId: null,
      createdAt: 1,
      updatedAt: 1,
    });

    expect(serialized).not.toHaveProperty("estimatedCost");
    expect(serialized.name).toBe("Test");
  });
});
