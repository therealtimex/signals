import { z } from "zod";
import { PLATFORMS } from "@/lib/db/platforms";
import { CONTACT_FIT_TIER_ENUM } from "@/lib/contact-fit";
import {
  IDENTITY_PROVENANCE_KIND_ENUM,
  IDENTITY_PROVENANCE_OBSERVED_AT_MAX,
  IDENTITY_PROVENANCE_SOURCE_URL_MAX_LENGTH,
} from "@/lib/identity-provenance";
import {
  CONTACT_ALIAS_MAX_LENGTH,
  CONTACT_ALIASES_MAX,
  CONTACT_ALIASES_PER_WRITE_MAX,
} from "@/lib/contact-aliases";
import {
  RELATIONSHIP_GOAL_ENUM,
  RELATIONSHIP_GOAL_STATUS_ENUM,
} from "@/lib/relationship-goals";

const funnelStage = z.enum([
  "prospect",
  "engaged",
  "qualified",
  "opportunity",
  "customer",
  "advocate",
]);

const relationshipGoal = z.enum(RELATIONSHIP_GOAL_ENUM);
const relationshipGoalStatus = z.enum(RELATIONSHIP_GOAL_STATUS_ENUM);

const platform = z.enum(PLATFORMS as unknown as [string, ...string[]]);

const contactFitTier = z.enum(CONTACT_FIT_TIER_ENUM);

const CONTACT_TAG_MAX_LENGTH = 200;

/** Where an identity came from (#571). kind is required whenever provenance is sent. */
export const identityProvenanceInputSchema = z
  .object({
    kind: z
      .enum(IDENTITY_PROVENANCE_KIND_ENUM)
      .describe(
        "self_declared: the subject linked this account on a profile they control (Luma profile, personal site, X bio). agent_verified: an agent corroborated it (name plus company or role). inferred: weaker match such as a search result. Strength: self_declared > agent_verified > inferred; a weaker kind never overwrites a stronger one already stored.",
      ),
    sourceUrl: z
      .string()
      .trim()
      .url()
      .max(IDENTITY_PROVENANCE_SOURCE_URL_MAX_LENGTH)
      .refine((value) => /^https?:\/\//i.test(value), { message: "sourceUrl must be http(s)" })
      .optional()
      .describe("Page that shows the evidence, e.g. the subject's Luma profile linking this account."),
    observedAt: z
      .number()
      .int()
      .positive()
      .max(IDENTITY_PROVENANCE_OBSERVED_AT_MAX, { message: "observedAt is unix seconds, not milliseconds" })
      .optional()
      .describe("Unix seconds when the evidence was observed; defaults to the write time."),
  })
  .describe(
    "Optional identity provenance. Omit it to leave the stored provenance unchanged; the same or a stronger kind replaces all three fields.",
  );

export const channelInputSchema = z.object({
  id: z.string().min(1).optional(),
  channelType: z.string().min(1),
  value: z.string().min(1),
  label: z.string().optional().nullable(),
  isPrimary: z.boolean().optional(),
  isVerified: z.boolean().optional(),
});

export const employmentInputSchema = z.object({
  id: z.string().min(1).optional(),
  orgId: z.string().min(1).optional(),
  orgName: z.string().optional(),
  title: z.string().optional().nullable(),
  startedAt: z.number().int().optional().nullable(),
  endedAt: z.number().int().optional().nullable(),
  isCurrent: z.boolean().optional(),
});

import { CREATED_SOURCES } from "@/lib/db/creation-sources";

export const queryContactsSchema = z.object({
  search: z.string().optional(),
  email: z.string().min(1).optional(),
  funnelStage: funnelStage.optional(),
  relationshipGoal: relationshipGoal.optional(),
  relationshipGoalStatus: relationshipGoalStatus.optional(),
  platform: platform.optional(),
  platformUserId: z.string().min(1).optional(),
  page: z.number().int().positive().optional(),
  pageSize: z.number().int().positive().max(100).optional(),
  sort: z
    .enum(["createdAt", "enrichmentScore", "fitScore"])
    .optional()
    .describe(
      "fitScore sorts best fit first (order defaults to desc) with unscored contacts last in either direction.",
    ),
  order: z.enum(["asc", "desc"]).optional(),
  createdSource: z.enum(CREATED_SOURCES).optional(),
  createdSourceDetail: z.string().min(1).optional(),
  createdWorkflowRunId: z.string().min(1).optional(),
  createdTemplateId: z.string().min(1).optional(),
  minEnrichmentScore: z.number().int().optional(),
  maxEnrichmentScore: z.number().int().optional(),
  tags: z
    .array(z.string().trim().min(1).max(CONTACT_TAG_MAX_LENGTH))
    .min(1)
    .max(20)
    .optional()
    .describe("Contacts carrying every listed tag (exact, case-sensitive match)."),
  nicheId: z
    .string()
    .min(1)
    .optional()
    .describe("Contacts linked to this niche by a belongs_to_niche edge."),
  fitTier: contactFitTier.optional(),
  minFitScore: z
    .number()
    .int()
    .min(0)
    .max(100)
    .optional()
    .describe("Inclusive lower bound on fitScore; unscored contacts never match."),
});

export const CONTACT_FIT_BATCH_MAX = 200;

/** One row of score_contact_fit. Every call overwrites all seven fit fields. */
export const scoreContactFitItemSchema = z.object({
  contactId: z.string().min(1),
  fitScore: z.number().int().min(0).max(100).describe("ICP fit, integer 0–100."),
  fitTier: contactFitTier,
  fitProduct: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .nullable()
    .optional()
    .describe(
      "Product slug the contact fits (e.g. from the workspace PRODUCTS.md); free-form, not validated, up to 120 characters.",
    ),
  fitConfidence: z
    .number()
    .min(0)
    .max(1)
    .nullable()
    .optional()
    .describe("Scorer confidence, 0–1 (same scale as persona confidence)."),
  fitRationale: z
    .string()
    .trim()
    .min(1)
    .max(2_000)
    .nullable()
    .optional()
    .describe("Why the contact fits, up to 2,000 characters."),
  fitScoreVersion: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .nullable()
    .optional()
    .describe(
      "Scoring-rubric version, up to 64 characters; overrides the batch-level fitScoreVersion for this row. Omitted, the row inherits the batch-level version; null clears it.",
    ),
});

const scoreContactFitShape = {
  fitScoreVersion: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .optional()
    .describe("Default scoring-rubric version for every row that does not set its own."),
};

/**
 * Runtime schema: rows are validated one by one in the handler so a bad row is
 * reported in its own result instead of rejecting the whole batch.
 */
export const scoreContactFitSchema = z.object({
  items: z.array(z.unknown()).min(1).max(CONTACT_FIT_BATCH_MAX),
  ...scoreContactFitShape,
});

/** Advertised schema (manifest/OpenAPI): the row shape the handler enforces per row. */
export const scoreContactFitDocumentedSchema = z.object({
  items: z
    .array(scoreContactFitItemSchema)
    .min(1)
    .max(CONTACT_FIT_BATCH_MAX)
    .describe(
      `1–${CONTACT_FIT_BATCH_MAX} rows. Each row is validated on its own and gets its own result.`,
    ),
  ...scoreContactFitShape,
});

export const resolvePlatformClaimSchema = z.object({
  platform: platform,
  platformUserId: z.string().min(1),
});

export const getContactSchema = z.object({
  contactId: z.string().min(1),
});

export const getContactArppSchema = getContactSchema.extend({
  visibility: z.enum(["internal", "public"]).optional(),
});

export const createContactSchema = z.object({
  name: z.string().min(1),
  email: z.string().email().optional().or(z.literal("")),
  phone: z.string().optional(),
  channels: z.array(channelInputSchema).optional(),
  employments: z.array(employmentInputSchema).optional(),
  company: z.string().optional(),
  title: z.string().optional(),
  headline: z.string().optional(),
  bio: z.string().optional(),
  location: z.string().optional(),
  website: z.string().optional(),
  platform: platform.optional(),
  platformUserId: z.string().min(1).optional(),
  platformHandle: z.string().optional(),
  platformUrl: z.string().optional(),
  avatarUrl: z.string().optional().describe(
    "Optional public https URL of the contact's profile photo. For LinkedIn Snowball, prefer the avatarUrl returned by attest_snowball_linkedin_identity. Navbar thumbs (shrink_100_100 / scale_100_100 / shrink_50_50) and the authenticated session viewer's photo are rejected. Derive any resolver slug only from a server-attested identity; never synthesize a profile slug. Must be http(s); file:// URLs and local paths are rejected.",
  ),
  identityEvidenceToken: z.string().min(1).optional().describe(
    "One-use token returned by attest_snowball_linkedin_identity. Required before a Network Snowball run can write a LinkedIn identity.",
  ),
  provenance: identityProvenanceInputSchema
    .optional()
    .describe(
      "Optional provenance for the platform identity created or matched from platform/platformUserId; ignored when no platform identity is given.",
    ),
  allowUnusualHandle: z.boolean().optional().describe(
    "Accept a handle that passes the platform's syntax but looks like junk: two characters or fewer, or a placeholder such as notwitter or none (#569). Set it only when the value really is the account. It never accepts a URL from another platform or invalid syntax.",
  ),
  notes: z.string().optional(),
  funnelStage: funnelStage.optional(),
  relationshipGoal: relationshipGoal.optional(),
  relationshipGoalStatus: relationshipGoalStatus.optional(),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  workflowRunId: z.string().min(1).optional(),
  templateId: z.string().min(1).optional(),
});

export const updateContactSchema = z.object({
  contactId: z.string().min(1),
  email: z.string().email().optional().or(z.literal("")),
  phone: z.string().optional(),
  channels: z.array(channelInputSchema).optional(),
  employments: z.array(employmentInputSchema).optional(),
  company: z.string().optional(),
  title: z.string().optional(),
  headline: z.string().optional(),
  bio: z.string().optional(),
  location: z.string().optional(),
  website: z.string().optional(),
  funnelStage: funnelStage.optional(),
  relationshipGoal: relationshipGoal.optional().nullable(),
  relationshipGoalStatus: relationshipGoalStatus.optional().nullable(),
  tags: z.string().optional(),
  is_self: z.boolean().optional(),
});

export const enrichContactSchema = z.object({
  contactId: z.string().min(1),
  company: z.string().optional(),
  title: z.string().optional(),
  headline: z.string().optional(),
  email: z.string().optional(),
  phone: z.string().optional(),
  location: z.string().optional(),
  website: z.string().optional(),
  bio: z.string().optional(),
  tags: z.array(z.string()).optional(),
  aliases: z
    .array(z.string().trim().min(1).max(CONTACT_ALIAS_MAX_LENGTH))
    .min(1)
    .max(CONTACT_ALIASES_PER_WRITE_MAX)
    .optional()
    .describe(
      "Other names the contact goes by (e.g. a nickname or the name on another platform). Appended, never replaced; deduped case-insensitively against stored aliases and the contact's name. A contact holds at most 50.",
    ),
  metadata: z.record(z.unknown()).optional(),
  observedEmails: z
    .array(
      z.object({
        address: z.string().trim().email(),
        evidenceUrl: z.string().url(),
        evidenceText: z.string().trim().min(1).max(2_000),
        sourcePlatform: platform.optional(),
      }),
    )
    .max(20)
    .optional(),
  employmentObservations: z
    .array(
      z.object({
        orgName: z.string().trim().min(1).max(240),
        title: z.string().trim().max(500).nullable().optional(),
        startedAt: z
          .number()
          .int()
          .nullable()
          .optional()
          .describe("UTC Unix seconds; omit when the profile date is too vague to normalize"),
        endedAt: z
          .number()
          .int()
          .nullable()
          .optional()
          .describe("UTC Unix seconds; omit for current roles or vague profile dates"),
        isCurrent: z.boolean(),
        evidenceUrl: z.string().url(),
        evidenceText: z.string().trim().min(1).max(2_000).optional(),
        sourcePlatform: platform.optional(),
      }),
    )
    .max(50)
    .optional(),
});

export const archiveContactSchema = z.object({
  contactId: z.string().min(1),
  reason: z.string().min(1),
});

export const findDuplicateContactsSchema = z.object({
  tiers: z.array(z.union([z.literal(1), z.literal(2), z.literal(3)])).optional(),
  minConfidence: z.number().min(0).max(1).optional(),
  limit: z.number().int().positive().max(200).optional(),
  contactIds: z.array(z.string().min(1)).optional(),
});

export const findDuplicateOrgsSchema = z.object({
  // Two tiers only: a shared domain or platform identity would be stronger evidence, but the write
  // path already refuses both, so no such duplicate can exist.
  tiers: z.array(z.union([z.literal(1), z.literal(2)])).optional(),
  minConfidence: z.number().min(0).max(1).optional(),
  limit: z.number().int().positive().max(200).optional(),
});

export const mergeOrgsSchema = z.object({
  primaryOrgId: z.string().min(1),
  secondaryOrgIds: z.array(z.string().min(1)).min(1).max(20),
  dryRun: z.boolean().optional().describe(
    "Run the merge and roll it back, returning exactly what a committed call would do. Call this first and show the plan before merging.",
  ),
  domain: z.string().optional().describe(
    "Which member domain becomes the survivor's primary. Must already belong to one of the merged orgs; adding a new domain is updateOrg's job.",
  ),
  force: z.boolean().optional().describe(
    "Merge a pair the duplicate detector refuses to suggest — a venture arm into its parent, a division, or a regional unit. Off by default; only set it when a human has confirmed the two records are one organization.",
  ),
  reason: z.string().optional(),
  workflowRunId: z.string().min(1).optional(),
});

export const mergeContactsSchema = z.object({
  primaryContactId: z.string().min(1),
  secondaryContactIds: z.array(z.string().min(1)).min(1),
  options: z
    .object({
      autoRecalculateScore: z.boolean().optional(),
      dryRun: z.boolean().optional(),
      reason: z.string().optional(),
      workflowRunId: z.string().optional(),
    })
    .optional(),
});

export const upsertContactIdentitySchema = z
  .object({
    id: z.string().optional(),
    contactId: z.string().min(1),
    platform: platform.optional(),
    platformUserId: z.string().min(1).optional(),
    platformHandle: z.string().optional(),
    platformUrl: z.string().optional(),
    platformData: z.record(z.unknown()).optional(),
    displayName: z.string().optional(),
    headline: z.string().optional(),
    bio: z.string().optional(),
    avatarUrl: z.string().optional().describe(
      "Optional public https URL of the contact's profile photo. For LinkedIn Snowball, prefer the avatarUrl returned by attest_snowball_linkedin_identity. Navbar thumbs (shrink_100_100 / scale_100_100 / shrink_50_50) and the authenticated session viewer's photo are rejected. Derive any resolver slug only from a server-attested identity; never synthesize a profile slug. Must be http(s); file:// URLs and local paths are rejected.",
    ),
    location: z.string().optional(),
    websiteUrl: z.string().optional(),
    isVerified: z.boolean().optional(),
    followersCount: z.number().int().optional(),
    followingCount: z.number().int().optional(),
    postsCount: z.number().int().optional(),
    listedCount: z.number().int().optional(),
    platformCreatedAt: z.number().int().optional(),
    isPrimary: z.boolean().optional(),
    isActive: z.boolean().optional(),
    lastSyncedAt: z.number().int().optional(),
    workflowRunId: z.string().min(1).optional(),
    templateId: z.string().min(1).optional(),
    candidateCompany: z.string().min(1).optional().describe(
      "Candidate company used during Snowball attestation. Signals also checks any existing contact company and will not let this field override a conflicting contact.",
    ),
    candidateTitle: z.string().min(1).optional().describe(
      "Candidate title used during Snowball attestation. Signals also checks any existing contact title and will not let this field override a conflicting contact.",
    ),
    identityEvidenceToken: z.string().min(1).optional().describe(
      "One-use token returned by attest_snowball_linkedin_identity. Required before a Network Snowball run can write a LinkedIn identity.",
    ),
    provenance: identityProvenanceInputSchema.optional(),
    allowUnusualHandle: z.boolean().optional().describe(
      "Accept a handle that passes the platform's syntax but looks like junk: two characters or fewer, or a placeholder such as notwitter or none (#569). Set it only when the value really is the account. It never accepts a URL from another platform or invalid syntax.",
    ),
  })
  .refine((data) => data.id || data.identityEvidenceToken || (data.platform && data.platformUserId), {
    message: "platform and platformUserId, or identityEvidenceToken, are required when creating a new identity",
  });

export const removeContactIdentitySchema = z.object({
  contactId: z.string().min(1).describe("The contact the identity belongs to."),
  identityId: z
    .string()
    .min(1)
    .describe("The identity's id, from get_contact identities[].id. It must belong to contactId."),
});

export const attestSnowballLinkedInIdentitySchema = z
  .object({
    snowballScopeToken: z.string().min(1).describe(
      "Dispatch capability copied exactly from the Network Snowball brief.",
    ),
    candidateName: z.string().min(1),
    candidateCompany: z.string().min(1).optional(),
    candidateTitle: z.string().min(1).optional(),
    profileUrl: z.string().url().describe(
      "Proposed LinkedIn /in/ URL. Signals opens it in the trusted browser session and derives the stored identity from the final URL.",
    ),
  })
  .refine((data) => data.candidateCompany || data.candidateTitle, {
    message: "candidateCompany or candidateTitle is required for browser-visible corroboration",
  });

export const listSnowballCandidatesSchema = z.object({
  workflowRunId: z.string().min(1).optional(),
  status: z.enum(["identity_unverified", "promoted", "dismissed"]).optional(),
  page: z.number().int().positive().optional(),
  pageSize: z.number().int().positive().max(100).optional(),
});

const goalTypeEnum = z.enum(["audience_growth", "lead_generation", "content_engagement", "pipeline_progression"]);

export const upsertGoalSchema = z
  .object({
    id: z.string().min(1).optional().describe(
      "Update this goal. Unknown ids are NOT_FOUND. Without id, a goal with the same name (trimmed, case-insensitive) and goalType that is active or paused is updated instead of creating a second one.",
    ),
    name: z.string().trim().min(1).optional().describe("Required without id."),
    goalType: goalTypeEnum.optional().describe("Required without id. One of the four existing goal types."),
    targetValue: z.number().int().positive().optional().describe("Required to create a goal."),
    currentValue: z.number().int().min(0).optional().describe(
      "Progress so far, the same value the dashboard's manual ± sets. It does not change status: reaching targetValue leaves an active goal active, as on the dashboard.",
    ),
    unit: z.string().trim().min(1).optional().describe('Required to create a goal, e.g. "meetings", "contacts", "followers".'),
    platform: z.enum(["x", "linkedin"]).nullable().optional().describe("Null means cross-platform."),
    deadline: z.number().int().nullable().optional().describe("Unix seconds; null clears it. A past deadline is allowed."),
    status: z.enum(["active", "achieved", "missed", "paused"]).optional().describe("Defaults to active on create."),
    nicheId: z.string().min(1).nullable().optional().describe(
      "Link the goal to this niche (a `targets` edge, goal → niche). A goal targets at most one niche: a different nicheId replaces the link, null removes it. The link does not change how progress is counted.",
    ),
    launchId: z.string().min(1).optional().describe(
      "Link a launch to the goal (a `contributes_to` edge, launch → goal). Adds to any existing launch links. The link does not change how progress is counted.",
    ),
  })
  .refine((data) => data.id || (data.name && data.goalType), {
    message: "name and goalType are required when no id is given",
  });

export const queryGoalsSchema = z.object({
  status: z.enum(["active", "achieved", "missed", "paused"]).optional(),
  goalType: z
    .enum(["audience_growth", "lead_generation", "content_engagement", "pipeline_progression"])
    .optional(),
  page: z.number().int().positive().optional(),
  pageSize: z.number().int().positive().max(100).optional(),
});

export const queryAnalyticsSchema = z.object({});

export const queryWorkflowsSchema = z.object({
  workflowType: z
    .enum(["sync", "import", "enrich", "search", "prune", "sequence", "agent", "simulate", "calibrate"])
    .optional(),
  status: z
    .enum(["pending", "running", "paused", "completed", "failed", "cancelled"])
    .optional(),
  page: z.number().int().positive().optional(),
  pageSize: z.number().int().positive().max(100).optional(),
});

export const queryContentSchema = z.object({
  contentType: z.enum(["post", "thread", "article", "newsletter", "dm", "reply"]).optional(),
  status: z
    .enum([
      "draft",
      "review",
      "approved",
      "scheduled",
      "published",
      "imported",
      "queued",
      "publishing",
      "failed",
    ])
    .optional(),
  page: z.number().int().positive().optional(),
  pageSize: z.number().int().positive().max(100).optional(),
});

export const createTaskSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
  dueDate: z.number().int().optional(),
  relatedContactId: z.string().optional(),
  relatedOrgId: z.string().optional(),
});

export const listWorkflowTemplatesSchema = z.object({
  status: z.enum(["active", "paused", "draft", "completed"]).optional(),
});

export const startWorkflowSchema = z.object({
  templateId: z.string().min(1),
  workflowType: z.enum(["search", "enrich", "prune", "agent", "nurture", "content", "sync"]).optional(),
  config: z.record(z.unknown()).optional(),
  systemPrompt: z.string().optional(),
  freshThread: z.boolean().optional(),
  parentWorkflowId: z.string().optional(),
  targetContactIds: z.array(z.string().min(1)).optional(),
});

export const dispatchFollowOnWorkflowSchema = z.object({
  parentWorkflowRunId: z.string().min(1),
  followOnAction: z.enum(["profile_pipeline", "contact_nurture", "social_patrol", "agentic_router"]),
  contactIds: z.array(z.string().min(1)).optional(),
});

export const getPersonaSchema = z.object({
  contactId: z.string().min(1),
  includeLocalOnly: z.boolean().optional(),
});

export const getPersonaEvidenceSchema = z.object({
  contactId: z.string().min(1),
});

export const generatePersonaSchema = z.object({
  contactId: z.string().min(1),
  force: z.boolean().optional(),
});

export const getPersonaJobSchema = z.object({
  jobId: z.string().min(1),
});

export const completePersonaJobSchema = z
  .object({
    jobId: z.string().min(1),
    success: z.boolean(),
    synthesis: z.union([z.string(), z.record(z.unknown())]).optional(),
    model: z.string().max(120).optional(),
    error: z.string().max(2000).optional(),
  })
  .refine((value) => !value.success || value.synthesis !== undefined, {
    message: "synthesis is required when success is true",
    path: ["synthesis"],
  });

export const upsertPersonaSchema = z
  .object({
    contactId: z.string().min(1),
    archetype: z.string().optional(),
    tone: z.string().optional(),
    summary: z.string().optional(),
    description: z.string().optional(),
    interests: z.array(z.string()).optional(),
    conversionTriggers: z.array(z.string()).optional(),
    engagementFormats: z.array(z.string()).optional(),
    confidence: z.number().min(0).max(1).optional(),
    scope: z.enum(["shared", "local_only"]).optional(),
    model: z.string().optional(),
    sourceWindow: z.record(z.unknown()).optional(),
    workflowRunId: z.string().optional(),
  })
  .refine(
    (data) =>
      data.archetype !== undefined ||
      data.tone !== undefined ||
      data.summary !== undefined ||
      data.description !== undefined ||
      data.interests !== undefined ||
      data.conversionTriggers !== undefined ||
      data.engagementFormats !== undefined ||
      data.confidence !== undefined ||
      data.scope !== undefined ||
      data.model !== undefined ||
      data.sourceWindow !== undefined ||
      data.workflowRunId !== undefined,
    { message: "At least one persona field is required besides contactId" },
  );

export const listMailAccountsSchema = z.object({});

export const completeWorkflowRunSchema = z.object({
  runId: z.string().min(1).describe("The workflow run ID to mark completed"),
  status: z.enum(["completed", "failed"]).default("completed").describe("Final status of the workflow run"),
  processedItems: z.number().int().nonnegative().optional().describe("Number of items processed"),
  successItems: z.number().int().nonnegative().optional().describe("Number of items successfully processed"),
  createdContactIds: z.array(z.string()).optional().describe("IDs of newly created/discovered contacts in this run"),
  summary: z.string().optional().describe("Summary of the run results and mapped cluster"),
  errors: z.array(z.string()).optional().describe("Any error messages encountered during the run"),
  result: z
    .object({
      fieldsUpdated: z.array(z.string()).optional(),
      unresolvedFields: z.array(z.string()).optional(),
      identityLinked: z.boolean().optional(),
      verifiedProfileUrls: z.array(z.string().url()).max(20).optional(),
      profileSectionsInspected: z
        .array(z.enum(["linkedin_about", "linkedin_contact_info", "linkedin_experience"]))
        .max(20)
        .optional(),
      emailsObserved: z.number().int().nonnegative().optional(),
      experiencesUpserted: z.number().int().nonnegative().optional(),
      visitedUrls: z.array(z.string().url()).optional(),
      blockedUrls: z.array(z.string().url()).max(20).optional(),
      serpCandidates: z
        .array(
          z
            .object({
              url: z.string().url(),
              totalScore: z.number(),
              reason: z.string(),
            })
            .passthrough(),
        )
        .max(20)
        .optional(),
      ambiguous: z.boolean().optional(),
      partial: z.boolean().optional(),
      identityProvenanceUsed: z
        .enum([...IDENTITY_PROVENANCE_KIND_ENUM, "unknown"])
        .optional()
        .describe(
          "Contact Web Research: which identity-provenance branch ran, read from the primary identity. unknown means none was recorded.",
        ),
      aliasesAdded: z
        .array(z.string().min(1).max(CONTACT_ALIAS_MAX_LENGTH))
        .max(CONTACT_ALIASES_MAX)
        .optional()
        .describe("Contact Web Research: names enrich_contact actually added as aliases in this run."),
      message: z.string().optional(),
    })
    .passthrough()
    .optional()
    .describe("Structured workflow-specific result fields persisted on the run"),
});

export const recordWorkflowRunContactsSchema = z.object({
  runId: z.string().trim().min(1),
  templateId: z.string().trim().min(1).optional(),
  contactIds: z.array(z.string().trim().min(1)).max(50).optional(),
});
