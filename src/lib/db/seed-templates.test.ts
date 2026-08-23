import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { getSystemTemplateByName } from "@/lib/db/queries/workflow-templates";
import {
  CONTACT_PROFILE_PIPELINE_TEMPLATE_NAME,
  seedTemplates,
} from "@/lib/db/seed-templates";
import { workflowTemplates } from "@/lib/db/schema";
import {
  DEFAULT_INTENT_KEYWORDS,
  SOCIAL_INTENT_PATROL_TEMPLATE_NAME,
  isSocialPatrolTemplateConfig,
  readSocialPatrolConfig,
} from "@/lib/workflows/social-patrol";
import {
  PROFILE_PUBLISH_TEMPLATE_NAME,
  isProfilePublishTemplateConfig,
  readProfilePublishConfig,
} from "@/lib/workflows/profile-publish";
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

    expect(config._seedVersion).toBe(8);
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
    const config = JSON.parse(updated.config ?? "{}") as Record<string, unknown>;
    expect(config).toMatchObject({
      _seedVersion: 8,
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
      limit?: number;
    };
    // Key names match find_duplicate_contacts' arguments so the prompt can tell
    // the agent to pass them straight through.
    expect(config.tiers).toEqual([1, 2]);
    expect(config.minConfidence).toBe(0.8);
    expect(config.limit).toBe(25);
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

describe("Social Intent Patrol seed", () => {
  beforeEach(() => {
    resetCoreTables();
  });

  it("seeds an Engage template carrying the patrol slider defaults", () => {
    seedTemplates();
    const template = getSystemTemplateByName(SOCIAL_INTENT_PATROL_TEMPLATE_NAME)!;

    expect(template.templateType).toBe("engagement");
    // Cross-platform: the acting target chosen at run time decides the platform.
    expect(template.platform).toBeNull();

    const config = JSON.parse(template.config ?? "{}") as Record<string, unknown>;
    expect(isSocialPatrolTemplateConfig(config)).toBe(true);
    expect(config).not.toHaveProperty("maxPosts");
    expect(config).not.toHaveProperty("durationMinutes");
    expect(readSocialPatrolConfig(config)).toEqual({
      targetId: null,
      maxComments: 5,
      maxScrapedContacts: 20,
      communities: [],
      intentKeywords: DEFAULT_INTENT_KEYWORDS,
      requireApproval: true,
    });
  });

  it("strips the retired maxPosts and durationMinutes from an older install on re-seed", () => {
    seedTemplates();
    const template = getSystemTemplateByName(SOCIAL_INTENT_PATROL_TEMPLATE_NAME)!;
    db.update(workflowTemplates).set({
      config: JSON.stringify({
        ...JSON.parse(template.config ?? "{}"),
        _seedVersion: 6,
        maxPosts: 2,
        durationMinutes: 40,
        // Operator-tuned controls must survive the migration.
        maxComments: 8,
      }),
    }).where(eq(workflowTemplates.id, template.id)).run();

    expect(seedTemplates().updated).toBe(1);
    const config = JSON.parse(
      getSystemTemplateByName(SOCIAL_INTENT_PATROL_TEMPLATE_NAME)!.config ?? "{}",
    ) as Record<string, unknown>;

    expect(config).not.toHaveProperty("maxPosts");
    expect(config).not.toHaveProperty("durationMinutes");
    expect(config._seedVersion).toBe(8);
    expect(config.maxComments).toBe(8);
    // The card copy is structural — an existing install must not keep describing a shift that
    // still posts to your own timeline.
    expect(getSystemTemplateByName(SOCIAL_INTENT_PATROL_TEMPLATE_NAME)!.description).toContain(
      "Outbound only",
    );
  });

  it("is idempotent across repeated seeding", () => {
    seedTemplates();
    expect(seedTemplates()).toEqual({ seeded: 0, updated: 0, skipped: true });
  });
});

describe("Profile Publishing & Repost seed", () => {
  beforeEach(() => {
    resetCoreTables();
  });

  it("seeds a Content template carrying the publishing defaults", () => {
    seedTemplates();
    const template = getSystemTemplateByName(PROFILE_PUBLISH_TEMPLATE_NAME)!;

    // The Content tab in the template gallery filters on templateType === "content".
    expect(template.templateType).toBe("content");
    // Cross-platform: the acting targets chosen at run time decide the platforms.
    expect(template.platform).toBeNull();

    const config = JSON.parse(template.config ?? "{}") as Record<string, unknown>;
    expect(isProfilePublishTemplateConfig(config)).toBe(true);
    expect(readProfilePublishConfig(config)).toEqual({
      targetIds: [],
      instructions: "",
      maxOriginalPosts: 1,
      maxReposts: 1,
      topics: [],
      tone: "technical",
      requireApproval: true,
    });
  });

  it("keeps the publishing lane out of community hunting", () => {
    seedTemplates();
    const template = getSystemTemplateByName(PROFILE_PUBLISH_TEMPLATE_NAME)!;

    expect(template.systemPrompt).toContain("Social Intent Patrol");
    expect(template.systemPrompt).toContain("maxOriginalPosts");
    expect(template.systemPrompt).toContain("maxReposts");
  });

  it("is idempotent across repeated seeding", () => {
    seedTemplates();
    expect(seedTemplates()).toEqual({ seeded: 0, updated: 0, skipped: true });
  });
});

describe("Contact Relationship Nurture seed", () => {
  beforeEach(() => {
    resetCoreTables();
  });

  it("seeds a Nurture template carrying relationship nurture defaults", () => {
    seedTemplates();
    const template = getSystemTemplateByName("Contact Relationship Nurture")!;

    expect(template).toBeDefined();
    expect(template.templateType).toBe("nurture");
    expect(template.platform).toBeNull();
    expect(template.systemPrompt).toContain("follow_back");
    expect(template.systemPrompt).toContain("repost_amplification");
    expect(template.systemPrompt).toContain("salted sleep delay");
  });
});
