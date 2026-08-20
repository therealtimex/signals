import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { getSystemTemplateByName } from "@/lib/db/queries/workflow-templates";
import {
  CONTACT_PROFILE_PIPELINE_TEMPLATE_NAME,
  seedTemplates,
} from "@/lib/db/seed-templates";
import { workflowTemplates } from "@/lib/db/schema";
import { resetCoreTables } from "@/test/db";

describe("Contact profile pipeline seed", () => {
  beforeEach(() => {
    resetCoreTables();
  });

  it("seeds the v2 hydrate → avatar → persona pipeline", () => {
    seedTemplates();
    const template = getSystemTemplateByName(CONTACT_PROFILE_PIPELINE_TEMPLATE_NAME)!;
    const config = JSON.parse(template.config ?? "{}") as {
      _seedVersion?: number;
      pipeline?: { version?: number; steps?: Array<{ id: string; handler: string }> };
    };

    expect(config._seedVersion).toBe(5);
    expect(config.pipeline?.version).toBe(2);
    expect(config.pipeline?.steps).toEqual([
      { id: "hydrate", executor: "code", handler: "hydrate_x_profiles" },
      { id: "avatar", executor: "code", handler: "enrich_contact_avatars" },
      { id: "persona", executor: "llm", handler: "generate_persona" },
    ]);
  });

  it("migrates structural fields while preserving user run controls", () => {
    seedTemplates();
    const template = getSystemTemplateByName(CONTACT_PROFILE_PIPELINE_TEMPLATE_NAME)!;
    db.update(workflowTemplates).set({
      config: JSON.stringify({
        _seedVersion: 4,
        customTopLevel: true,
        pipeline: {
          version: 1,
          planner: "legacy_planner",
          batchSize: 7,
          filters: { needsAvatar: false, needsPersona: true, personaStale: true },
          scheduleDrain: true,
          customPipelineField: "keep",
          steps: [
            { id: "avatar", executor: "code", handler: "enrich_contact_avatars" },
            { id: "persona", executor: "llm", handler: "generate_persona" },
          ],
        },
      }),
    }).where(eq(workflowTemplates.id, template.id)).run();

    expect(seedTemplates().updated).toBe(1);
    const updated = getSystemTemplateByName(CONTACT_PROFILE_PIPELINE_TEMPLATE_NAME)!;
    const config = JSON.parse(updated.config ?? "{}") as Record<string, any>;
    expect(config).toMatchObject({
      _seedVersion: 5,
      customTopLevel: true,
      pipeline: {
        version: 2,
        planner: "contact_profile",
        batchSize: 7,
        filters: { needsAvatar: false, needsPersona: true, personaStale: true },
        scheduleDrain: true,
        customPipelineField: "keep",
      },
    });
    expect(config.pipeline.steps.map((step: { id: string }) => step.id)).toEqual([
      "hydrate",
      "avatar",
      "persona",
    ]);
  });
});

describe("Deduplicate & Merge Contacts seed", () => {
  beforeEach(() => {
    resetCoreTables();
  });

  it("seeds the dedupe template into the Prune category", () => {
    seedTemplates();
    const template = getSystemTemplateByName("Deduplicate & Merge Contacts")!;

    // The Prune tab in the template gallery filters on templateType === "pruning".
    expect(template.templateType).toBe("pruning");
    expect(template.isSystem).toBe(1);
    expect(template.status).toBe("active");
  });

  it("points the prompt at the tools that back it", () => {
    seedTemplates();
    const template = getSystemTemplateByName("Deduplicate & Merge Contacts")!;

    expect(template.systemPrompt).toContain("find_duplicate_contacts");
    expect(template.systemPrompt).toContain("merge_contacts");
    expect(template.systemPrompt).toContain("dryRun");

    const config = JSON.parse(template.config ?? "{}") as {
      tiers?: number[];
      minConfidence?: number;
    };
    expect(config.tiers).toEqual([1, 2]);
    expect(config.minConfidence).toBe(0.8);
  });

  it("is idempotent across repeated seeding", () => {
    seedTemplates();
    seedTemplates();
    const rows = db
      .select()
      .from(workflowTemplates)
      .where(eq(workflowTemplates.name, "Deduplicate & Merge Contacts"))
      .all();
    expect(rows).toHaveLength(1);
  });
});
