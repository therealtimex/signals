import { describe, expect, it } from "vitest";
import {
  buildTemplateConfig,
  extractLimitsFromConfig,
  parseTemplateConfig,
} from "@/lib/workflows/template-config";
import { buildAgentWorkflowBrief, getTemplateToolsHint } from "@/lib/workflows/template-brief";
import { buildSocialPatrolTemplateConfig } from "@/lib/workflows/social-patrol";
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
    expect(brief).not.toContain("Social Intent Patrol execution contract");
  });

  it("keeps seed bookkeeping out of the agent's runtime config", () => {
    const brief = buildAgentWorkflowBrief({
      template: {
        id: "tpl_dedupe",
        name: "Deduplicate & Merge Contacts",
        description: "Consolidate duplicate records",
        templateType: "pruning",
        platform: null,
        systemPrompt: "Merge duplicates.",
        targetPersona: null,
      },
      workflowRunId: "run_dedupe",
      config: { tiers: [1, 2], minConfidence: 0.8, limit: 25, _seedVersion: 5 },
      signalsBaseUrl: "http://localhost:3010",
    });

    expect(brief).toContain('"minConfidence": 0.8');
    expect(brief).not.toContain("_seedVersion");
  });

  it("appends the patrol contract only for social patrol configs", () => {
    const brief = buildAgentWorkflowBrief({
      template: {
        id: "tpl_patrol",
        name: "Social Intent Patrol",
        description: "Patrol communities",
        templateType: "engagement",
        platform: null,
        systemPrompt: "Patrol the feed.",
        targetPersona: "High-intent posters",
      },
      workflowRunId: "run_2",
      config: buildSocialPatrolTemplateConfig(),
      signalsBaseUrl: "http://localhost:3000",
    });

    expect(brief).toContain("Social Intent Patrol execution contract");
    expect(brief).toContain("signals-pp-cli targets prepare");
    // The shared execution requirements still apply.
    expect(brief).toContain("Do not call legacy in-process workflow runners.");
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
      rtxThreadSlug: null,
      isSystem: 1,
      sourceTemplateId: null,
      createdAt: 1,
      updatedAt: 1,
    });

    expect(serialized).not.toHaveProperty("estimatedCost");
    expect(serialized.name).toBe("Test");
  });
});
