import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { createTemplate, getSystemTemplateByName } from "@/lib/db/queries/workflow-templates";
import {
  CONTACT_PROFILE_PIPELINE_TEMPLATE_NAME,
  CONTACT_WEB_RESEARCH_TEMPLATE_NAME,
  PLATFORM_NATIVE_WRITING_TEMPLATE_NAME,
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
import { isSignalsWritingTemplateConfig } from "@/lib/workflows/signals-writing";
import {
  WRITING_INTENT_CONFIG_KEY,
  readWritingIntentComposition,
} from "@/lib/workflows/writing-composition";

describe("Platform-native writing seed", () => {
  beforeEach(() => resetCoreTables());

  it("seeds the bounded writing template without retired tool names", () => {
    seedTemplates();
    const template = getSystemTemplateByName(PLATFORM_NATIVE_WRITING_TEMPLATE_NAME)!;
    expect(template.templateType).toBe("content");
    expect(template.isSystem).toBe(1);
    expect(template.systemPrompt).not.toMatch(/save_draft|report_progress|search_web/);
    expect(
      isSignalsWritingTemplateConfig(
        JSON.parse(template.config ?? "{}") as Record<string, unknown>,
      ),
    ).toBe(true);
  });

  it("renames and rewrites the legacy Thought Leadership template in place", () => {
    const legacy = createTemplate({
      name: "Thought Leadership Posts",
      templateType: "content",
      status: "active",
      config: JSON.stringify({ _seedVersion: 24, topics: ["keep"] }),
      systemPrompt: "Use search_web, save_draft, and report_progress",
      isSystem: 1,
    });
    seedTemplates();
    const migrated = getSystemTemplateByName(PLATFORM_NATIVE_WRITING_TEMPLATE_NAME)!;
    expect(migrated.id).toBe(legacy.id);
    expect(getSystemTemplateByName("Thought Leadership Posts")).toBeUndefined();
    const config = JSON.parse(migrated.config ?? "{}") as Record<string, unknown>;
    expect(config).toMatchObject({ _seedVersion: 31, topics: ["keep"] });
    expect(isSignalsWritingTemplateConfig(config)).toBe(true);
  });
});

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

    expect(config._seedVersion).toBe(31);
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
    const config = JSON.parse(updated.config ?? "{}") as {
      _seedVersion?: number;
      customTopLevel?: boolean;
      pipeline?: {
        version?: number;
        planner?: string;
        batchSize?: number;
        steps?: Array<{ id: string }>;
      };
    };
    expect(config).toMatchObject({
      _seedVersion: 31,
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
    expect(config.pipeline?.steps?.map((step: { id: string }) => step.id)).toEqual([
      "hydrate",
      "avatar",
      "persona",
    ]);
  });

  it("seeds batch chaining on", () => {
    seedTemplates();
    const template = getSystemTemplateByName(CONTACT_PROFILE_PIPELINE_TEMPLATE_NAME)!;
    const config = JSON.parse(template.config ?? "{}") as {
      pipeline?: { scheduleDrain?: boolean };
    };

    expect(config.pipeline?.scheduleDrain).toBe(true);
  });

  it("turns batch chaining on for an existing install without touching its batch size", () => {
    seedTemplates();
    const template = getSystemTemplateByName(CONTACT_PROFILE_PIPELINE_TEMPLATE_NAME)!;
    // An install seeded before #426: one batch per manual run, backlog never drains.
    db.update(workflowTemplates).set({
      config: JSON.stringify({
        _seedVersion: 30,
        pipeline: {
          version: 2,
          planner: "contact_profile",
          batchSize: 7,
          filters: { needsAvatar: true, needsPersona: true, personaStale: false },
          scheduleDrain: false,
          steps: [
            { id: "hydrate", executor: "code", handler: "hydrate_x_profiles" },
            { id: "avatar", executor: "code", handler: "enrich_contact_avatars" },
            { id: "persona", executor: "llm", handler: "generate_persona" },
          ],
        },
      }),
    }).where(eq(workflowTemplates.id, template.id)).run();

    expect(seedTemplates().updated).toBe(1);
    const config = JSON.parse(
      getSystemTemplateByName(CONTACT_PROFILE_PIPELINE_TEMPLATE_NAME)!.config ?? "{}",
    ) as { pipeline?: { scheduleDrain?: boolean; batchSize?: number } };

    expect(config.pipeline?.scheduleDrain).toBe(true);
    expect(config.pipeline?.batchSize).toBe(7);
  });
});

describe("Contact Web Research seed", () => {
  beforeEach(() => resetCoreTables());

  it("seeds the scored RTX browser research contract", () => {
    seedTemplates();
    const template = getSystemTemplateByName(CONTACT_WEB_RESEARCH_TEMPLATE_NAME)!;
    const config = JSON.parse(template.config ?? "{}") as Record<string, unknown>;

    expect(template.templateType).toBe("enrichment");
    expect(template.estimatedCost).toBe(0.2);
    expect(config).toMatchObject({
      _seedVersion: 31,
      contactWebResearch: { version: 2 },
      acceptsContactId: true,
    });
    expect(template.systemPrompt).toContain("scored");
    expect(template.systemPrompt).toContain("get_contact_arpp");
    expect(template.systemPrompt).toContain("totalScore >= 60");
    expect(template.systemPrompt).toContain("complete_workflow_run");
    expect(template.systemPrompt).toContain("Session name");
    expect(template.systemPrompt).toContain("authwall");
    expect(template.systemPrompt).toContain("complete visible Experience section");
    expect(template.systemPrompt).toContain("observedEmails");
    expect(template.systemPrompt).toContain("source confirmation as mailbox/deliverability verification");
    expect(template.systemPrompt).toContain("profileSectionsInspected");
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
    expect(config._seedVersion).toBe(31);
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
    expect(template.systemPrompt).toContain("assist_only");
    expect(template.systemPrompt).not.toMatch(/Publish an organic spotlight post|Send a tailored direct message/);
  });

  it("opts the seeded template into the shared writing-intent contract", () => {
    seedTemplates();
    const config = JSON.parse(
      getSystemTemplateByName("Contact Relationship Nurture")!.config ?? "{}",
    ) as Record<string, unknown>;

    expect(readWritingIntentComposition(config)).toMatchObject({
      consumer: "contact_relationship_nurture",
      mandate: "assist_only",
      approvalPolicy: "explicit",
    });
  });

  it("migrates an older install onto the writing-intent contract without losing run controls", () => {
    seedTemplates();
    const template = getSystemTemplateByName("Contact Relationship Nurture")!;
    const existingConfig = JSON.parse(template.config ?? "{}") as Record<string, unknown>;
    delete existingConfig[WRITING_INTENT_CONFIG_KEY];
    db.update(workflowTemplates).set({
      config: JSON.stringify({ ...existingConfig, _seedVersion: 28, maxTargets: 42 }),
    }).where(eq(workflowTemplates.id, template.id)).run();

    seedTemplates();
    const migrated = JSON.parse(
      getSystemTemplateByName("Contact Relationship Nurture")!.config ?? "{}",
    ) as Record<string, unknown>;

    expect(migrated.maxTargets).toBe(42);
    expect(readWritingIntentComposition(migrated)?.consumer).toBe("contact_relationship_nurture");
  });

  it("normalizes a stale disabled approval gate once while preserving run controls", () => {
    seedTemplates();
    const template = getSystemTemplateByName("Contact Relationship Nurture")!;
    const existingConfig = JSON.parse(template.config ?? "{}") as Record<string, unknown>;
    db.update(workflowTemplates).set({
      config: JSON.stringify({
        ...existingConfig,
        _seedVersion: 29,
        requireApproval: false,
        maxTargets: 42,
      }),
    }).where(eq(workflowTemplates.id, template.id)).run();
    const info = vi.spyOn(console, "info").mockImplementation(() => {});

    expect(seedTemplates().updated).toBe(1);
    const migrated = JSON.parse(
      getSystemTemplateByName("Contact Relationship Nurture")!.config ?? "{}",
    ) as Record<string, unknown>;
    expect(migrated).toMatchObject({ _seedVersion: 31, requireApproval: true, maxTargets: 42 });
    expect(info).toHaveBeenCalledTimes(1);

    seedTemplates();
    expect(info).toHaveBeenCalledTimes(1);
  });
});

describe("Snowball Seed Scout seed", () => {
  beforeEach(() => {
    resetCoreTables();
  });

  it("seeds heartbeat deploy template with scout defaults", () => {
    seedTemplates();
    const template = getSystemTemplateByName("Snowball Seed Scout")!;

    expect(template).toBeDefined();
    expect(template.templateType).toBe("prospecting");
    expect(template.systemPrompt).toContain("heartbeat");

    const config = JSON.parse(template.config ?? "{}") as {
      _seedVersion?: number;
      snowballSeedScout?: { version?: number; executionKind?: string };
      maxLinksPerRun?: number;
    };
    expect(config._seedVersion).toBe(31);
    expect(config.snowballSeedScout?.executionKind).toBe("heartbeat_shell");
    expect(config.maxLinksPerRun).toBe(5);
  });
});

describe("Network Snowball seed", () => {
  beforeEach(() => {
    resetCoreTables();
  });

  it("seeds Network Snowball template carrying snowball defaults", () => {
    seedTemplates();
    const template = getSystemTemplateByName("Network Snowball")!;

    expect(template).toBeDefined();
    expect(template.templateType).toBe("prospecting");
    expect(template.platform).toBeNull();
    expect(template.systemPrompt).toContain("lead partners, angel investors, co-founders");
    expect(template.systemPrompt).toContain("Anti-Hallucination & Bot Gate");
    expect(template.systemPrompt).toContain("Never guess vanity profile links");

    const config = JSON.parse(template.config ?? "{}") as {
      _seedVersion?: number;
      networkSnowball?: { version?: number };
      focus?: string;
      maxContacts?: number;
      maxHops?: number;
    };
    expect(config._seedVersion).toBe(31);
    expect(config.networkSnowball?.version).toBe(1);
    expect(config.focus).toBe("investors_and_angels");
    expect(config.maxContacts).toBe(10);
    expect(config.maxHops).toBe(1);
  });

  it("refreshes a v22 prompt with workflow attribution flags", () => {
    seedTemplates();
    const template = getSystemTemplateByName("Network Snowball")!;
    const existingConfig = JSON.parse(template.config ?? "{}") as Record<string, unknown>;

    db.update(workflowTemplates).set({
      systemPrompt:
        "Import contacts with signals-pp-cli import contacts --file contacts.csv --dedupe-only.",
      config: JSON.stringify({ ...existingConfig, _seedVersion: 22 }),
    }).where(eq(workflowTemplates.id, template.id)).run();

    expect(seedTemplates().updated).toBe(1);
    const updated = getSystemTemplateByName("Network Snowball")!;
    const updatedConfig = JSON.parse(updated.config ?? "{}") as { _seedVersion?: number };

    expect(updated.systemPrompt).toContain("--workflow-run-id <runId>");
    expect(updated.systemPrompt).toContain("--template-id <templateId>");
    expect(updatedConfig._seedVersion).toBe(31);
  });
});
