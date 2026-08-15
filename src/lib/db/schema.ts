import { sqliteTable, text, integer, real, index, uniqueIndex } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { PLATFORM_ENUM } from "./platforms";

// Helper for default timestamps (unix epoch seconds)
const timestamps = {
  createdAt: integer("created_at")
    .notNull()
    .default(sql`(unixepoch())`),
  updatedAt: integer("updated_at")
    .notNull()
    .default(sql`(unixepoch())`),
};

// --- Platform Accounts ---

export const platformAccounts = sqliteTable("platform_accounts", {
  id: text("id").primaryKey(),
  platform: text("platform", { enum: PLATFORM_ENUM }).notNull(),
  displayName: text("display_name").notNull(),
  authType: text("auth_type", { enum: ["oauth", "session", "api_key"] }).notNull(),
  credentialsEncrypted: text("credentials_encrypted"), // JSON string, AES-256
  rateLimitState: text("rate_limit_state"), // JSON
  status: text("status", { enum: ["active", "paused", "needs_reauth"] })
    .notNull()
    .default("active"),
  lastSyncedAt: integer("last_synced_at"),
  ...timestamps,
});

// --- Contacts ---

export const contacts = sqliteTable("contacts", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  firstName: text("first_name"),
  lastName: text("last_name"),
  headline: text("headline"),
  company: text("company"),
  title: text("title"),
  // Deprecated: use contactIdentities table instead
  platform: text("platform", { enum: PLATFORM_ENUM }),
  platformUserId: text("platform_user_id"),
  profileUrl: text("profile_url"),
  avatarUrl: text("avatar_url"),
  email: text("email"),
  phone: text("phone"),
  bio: text("bio"),
  location: text("location"),
  website: text("website"),
  photoUrl: text("photo_url"),
  verifiedEmail: integer("verified_email").notNull().default(0),
  enrichmentScore: integer("enrichment_score").notNull().default(0),
  tags: text("tags").default("[]"), // JSON array
  funnelStage: text("funnel_stage", {
    enum: ["prospect", "engaged", "qualified", "opportunity", "customer", "advocate"],
  })
    .notNull()
    .default("prospect"),
  score: integer("score").notNull().default(0),
  metadata: text("metadata").default("{}"), // JSON
  lastInteractionAt: integer("last_interaction_at"),
  ...timestamps,
}, (table) => [
  index("idx_contacts_email").on(table.email),
  index("idx_contacts_name").on(table.name),
  index("idx_contacts_company").on(table.company),
]);

// --- Contact Identities (multi-platform golden record) ---

export const contactIdentities = sqliteTable("contact_identities", {
  id: text("id").primaryKey(),
  contactId: text("contact_id")
    .notNull()
    .references(() => contacts.id, { onDelete: "cascade" }),
  platform: text("platform", { enum: PLATFORM_ENUM }).notNull(),
  platformUserId: text("platform_user_id").notNull(),
  platformHandle: text("platform_handle"),
  platformUrl: text("platform_url"),
  platformData: text("platform_data").default("{}"), // JSON
  displayName: text("display_name"),
  bio: text("bio"),
  avatarUrl: text("avatar_url"),
  location: text("location"),
  websiteUrl: text("website_url"),
  isVerified: integer("is_verified", { mode: "boolean" }),
  followersCount: integer("followers_count"),
  followingCount: integer("following_count"),
  postsCount: integer("posts_count"),
  listedCount: integer("listed_count"),
  platformCreatedAt: integer("platform_created_at"),
  statsUpdatedAt: integer("stats_updated_at"),
  isPrimary: integer("is_primary").notNull().default(0),
  isActive: integer("is_active").notNull().default(1),
  lastSyncedAt: integer("last_synced_at"),
  syncErrors: text("sync_errors"),
  ...timestamps,
}, (table) => [
  uniqueIndex("idx_identity_platform_user").on(table.platform, table.platformUserId),
  index("idx_identity_contact").on(table.contactId),
  index("idx_identity_followers").on(table.followersCount),
]);

// --- Identity Metrics (time-series stat snapshots per platform identity) ---

export const identityMetrics = sqliteTable("identity_metrics", {
  id: text("id").primaryKey(),
  contactIdentityId: text("contact_identity_id")
    .notNull()
    .references(() => contactIdentities.id, { onDelete: "cascade" }),
  snapshotAt: integer("snapshot_at")
    .notNull()
    .default(sql`(unixepoch())`),
  followersCount: integer("followers_count"),
  followingCount: integer("following_count"),
  postsCount: integer("posts_count"),
  listedCount: integer("listed_count"),
  engagementRate: real("engagement_rate"),
  metadata: text("metadata").default("{}"),
}, (table) => [
  index("idx_identity_metrics_identity_time").on(table.contactIdentityId, table.snapshotAt),
]);

// --- Workflow Templates (formerly "campaigns") ---

export const workflowTemplates = sqliteTable("workflow_templates", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  platform: text("platform", { enum: PLATFORM_ENUM }),
  templateType: text("template_type", {
    enum: ["outreach", "engagement", "content", "nurture", "prospecting", "enrichment", "pruning"],
  }).notNull(),
  status: text("status", { enum: ["draft", "active", "paused", "completed"] })
    .notNull()
    .default("draft"),
  config: text("config").default("{}"), // JSON - targeting, timing, daily limits
  goalMetrics: text("goal_metrics").default("{}"), // JSON
  startsAt: integer("starts_at"),
  endsAt: integer("ends_at"),
  // Agent runner columns
  systemPrompt: text("system_prompt"), // Claude system prompt for this template
  targetPersona: text("target_persona"), // Description of target contact persona
  estimatedCost: real("estimated_cost").notNull().default(0), // Estimated cost per run in USD
  totalRuns: integer("total_runs").notNull().default(0), // Lifetime run count
  lastRunAt: integer("last_run_at"), // Timestamp of most recent run
  // User template columns
  isSystem: integer("is_system").notNull().default(0), // 1 = system-seeded, 0 = user
  sourceTemplateId: text("source_template_id"), // FK to workflowTemplates.id (self-ref, managed via migration SQL)
  ...timestamps,
});

// --- Workflow Template Steps (formerly "campaign_steps") ---

export const workflowTemplateSteps = sqliteTable("workflow_template_steps", {
  id: text("id").primaryKey(),
  templateId: text("template_id")
    .notNull()
    .references(() => workflowTemplates.id, { onDelete: "cascade" }),
  stepIndex: integer("step_index").notNull(),
  stepType: text("step_type", {
    enum: ["connect", "message", "follow", "like", "comment", "wait", "condition"],
  }).notNull(),
  config: text("config").default("{}"), // JSON - template, duration, condition
  delayHours: integer("delay_hours").default(0),
});

// --- Workflow Enrollments (formerly "campaign_contacts") ---

export const workflowEnrollments = sqliteTable("workflow_enrollments", {
  id: text("id").primaryKey(),
  templateId: text("template_id")
    .notNull()
    .references(() => workflowTemplates.id, { onDelete: "cascade" }),
  contactId: text("contact_id")
    .notNull()
    .references(() => contacts.id, { onDelete: "cascade" }),
  workflowRunId: text("workflow_run_id").references(() => workflowRuns.id),
  status: text("status", {
    enum: ["pending", "active", "completed", "replied", "removed"],
  })
    .notNull()
    .default("pending"),
  currentStepIndex: integer("current_step_index").notNull().default(0),
  enrolledAt: integer("enrolled_at")
    .notNull()
    .default(sql`(unixepoch())`),
  completedAt: integer("completed_at"),
});

// --- Content Items ---

export const contentItems = sqliteTable("content_items", {
  id: text("id").primaryKey(),
  title: text("title"), // nullable — tweets/DMs have no title
  body: text("body"),
  contentType: text("content_type", {
    enum: ["post", "article", "thread", "reply", "image", "video", "email", "dm", "newsletter"],
  }).notNull(),
  platformTarget: text("platform_target"),
  mediaPaths: text("media_paths").default("[]"), // JSON array of local paths
  status: text("status", {
    enum: ["draft", "review", "approved", "scheduled", "published", "imported"],
  })
    .notNull()
    .default("draft"),
  aiGenerated: integer("ai_generated", { mode: "boolean" }).notNull().default(false),
  generationPrompt: text("generation_prompt"),
  scheduledAt: integer("scheduled_at"),
  // Phase 2 additions
  origin: text("origin", { enum: ["authored", "received", "imported"] }),
  direction: text("direction", { enum: ["inbound", "outbound"] }),
  platformAccountId: text("platform_account_id").references(() => platformAccounts.id),
  threadId: text("thread_id"), // groups threaded content
  parentItemId: text("parent_item_id"), // self-reference for replies
  contactId: text("contact_id").references(() => contacts.id), // associated contact
  platformData: text("platform_data").default("{}"), // JSON — raw platform-specific data
  ...timestamps,
}, (table) => [
  index("idx_content_items_type").on(table.contentType),
  index("idx_content_items_status").on(table.status),
  index("idx_content_items_origin").on(table.origin),
  index("idx_content_items_account").on(table.platformAccountId),
]);

// --- Media Assets ---

export const mediaAssets = sqliteTable("media_assets", {
  id: text("id").primaryKey(),
  filename: text("filename").notNull(),
  storagePath: text("storage_path").notNull(), // relative: "{nanoid}.{ext}"
  mimeType: text("mime_type").notNull(),
  fileSize: integer("file_size").notNull(), // bytes
  width: integer("width"), // images only
  height: integer("height"), // images only
  contentItemId: text("content_item_id").references(() => contentItems.id, { onDelete: "set null" }),
  platformTarget: text("platform_target", { enum: PLATFORM_ENUM }),
  ...timestamps,
}, (table) => [
  index("idx_media_assets_content_item").on(table.contentItemId),
]);

// --- Content Posts (published instances) ---

export const contentPosts = sqliteTable("content_posts", {
  id: text("id").primaryKey(),
  contentItemId: text("content_item_id")
    .notNull()
    .references(() => contentItems.id, { onDelete: "cascade" }),
  platformAccountId: text("platform_account_id")
    .notNull()
    .references(() => platformAccounts.id, { onDelete: "cascade" }),
  platformPostId: text("platform_post_id"),
  platformUrl: text("platform_url"),
  publishedAt: integer("published_at"),
  status: text("status", {
    enum: ["scheduled", "publishing", "published", "failed", "imported"],
  })
    .notNull()
    .default("scheduled"),
  engagementSnapshot: text("engagement_snapshot").default("{}"), // JSON
}, (table) => [
  uniqueIndex("idx_content_posts_platform_id").on(table.platformPostId, table.platformAccountId),
]);

// --- Engagements ---

export const engagements = sqliteTable("engagements", {
  id: text("id").primaryKey(),
  contactId: text("contact_id")
    .references(() => contacts.id, { onDelete: "cascade" }), // nullable for anonymous engagement
  platformAccountId: text("platform_account_id").references(() => platformAccounts.id),
  engagementType: text("engagement_type", {
    enum: [
      "connection_request",
      "message",
      "like",
      "comment",
      "share",
      "follow",
      "view",
      "reply",
      "retweet",
      "quote",
      "bookmark",
      "impression",
      "click",
      "open",
      "restack",
      "reaction",
    ],
  }).notNull(),
  direction: text("direction", { enum: ["inbound", "outbound"] }).notNull(),
  content: text("content"),
  templateId: text("template_id").references(() => workflowTemplates.id),
  workflowRunId: text("workflow_run_id").references(() => workflowRuns.id),
  // Phase 2 additions
  contentPostId: text("content_post_id").references(() => contentPosts.id),
  platform: text("platform", { enum: PLATFORM_ENUM }),
  platformEngagementId: text("platform_engagement_id"), // dedup key
  threadId: text("thread_id"),
  source: text("source"), // e.g. "timeline", "notification", "search"
  platformData: text("platform_data").default("{}"), // JSON
  createdAt: integer("created_at")
    .notNull()
    .default(sql`(unixepoch())`),
}, (table) => [
  index("idx_engagements_contact").on(table.contactId),
  index("idx_engagements_content_post").on(table.contentPostId),
  index("idx_engagements_platform_id").on(table.platformEngagementId),
]);

// --- Content Activities (contactless platform actions on content; ADR-022-8) ---

export const contentActivities = sqliteTable("content_activities", {
  id: text("id").primaryKey(),
  activityType: text("activity_type").notNull(),
  direction: text("direction", { enum: ["inbound", "outbound", "mutual"] }),
  summary: text("summary"),
  occurredAt: integer("occurred_at").notNull(),
  scope: text("scope", { enum: ["shared", "local_only"] })
    .notNull()
    .default("shared"),
  source: text("source").notNull(),
  engagementId: text("engagement_id").references(() => engagements.id),
  contentItemId: text("content_item_id").references(() => contentItems.id, { onDelete: "set null" }),
  contentPostId: text("content_post_id").references(() => contentPosts.id),
  platform: text("platform", { enum: PLATFORM_ENUM }),
  workflowRunId: text("workflow_run_id").references(() => workflowRuns.id),
  metadata: text("metadata").default("{}"),
  createdAt: integer("created_at")
    .notNull()
    .default(sql`(unixepoch())`),
}, (table) => [
  index("idx_content_activities_post").on(table.contentPostId),
  index("idx_content_activities_item_time").on(table.contentItemId, table.occurredAt),
  uniqueIndex("idx_content_activities_engagement").on(table.engagementId),
]);

// --- Tasks ---

export const tasks = sqliteTable("tasks", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description"),
  taskType: text("task_type", {
    enum: ["manual", "agent_review", "follow_up", "content_review"],
  })
    .notNull()
    .default("manual"),
  status: text("status", { enum: ["todo", "in_progress", "blocked", "done"] })
    .notNull()
    .default("todo"),
  priority: text("priority", { enum: ["low", "medium", "high", "urgent"] })
    .notNull()
    .default("medium"),
  assignee: text("assignee", { enum: ["user", "agent"] })
    .notNull()
    .default("user"),
  relatedContactId: text("related_contact_id").references(() => contacts.id),
  relatedTemplateId: text("related_template_id").references(() => workflowTemplates.id),
  dueAt: integer("due_at"),
  completedAt: integer("completed_at"),
  ...timestamps,
});

// --- Sync Cursors (pagination state for platform imports) ---

export const syncCursors = sqliteTable("sync_cursors", {
  id: text("id").primaryKey(),
  platformAccountId: text("platform_account_id")
    .notNull()
    .references(() => platformAccounts.id, { onDelete: "cascade" }),
  dataType: text("data_type", {
    enum: ["tweets", "mentions", "followers", "following", "dms", "likes", "connections", "google_contacts", "gmail_metadata", "x_profiles"],
  }).notNull(),
  cursor: text("cursor"), // platform pagination token
  oldestFetchedAt: integer("oldest_fetched_at"), // oldest item timestamp fetched
  newestFetchedAt: integer("newest_fetched_at"), // newest item timestamp fetched
  totalItemsSynced: integer("total_items_synced").notNull().default(0),
  syncStatus: text("sync_status", {
    enum: ["idle", "syncing", "completed", "failed"],
  })
    .notNull()
    .default("idle"),
  syncProgress: text("sync_progress"), // JSON — { current, total, message }
  syncDirection: text("sync_direction", { enum: ["forward", "backward"] })
    .notNull()
    .default("backward"), // backward = fetch older, forward = fetch newer
  lastSyncStartedAt: integer("last_sync_started_at"),
  lastSyncCompletedAt: integer("last_sync_completed_at"),
  lastError: text("last_error"),
  ...timestamps,
}, (table) => [
  uniqueIndex("idx_sync_cursor_account_type").on(table.platformAccountId, table.dataType),
]);

// --- Workflow Runs (observable pipeline executions) ---

export const workflowRuns = sqliteTable("workflow_runs", {
  id: text("id").primaryKey(),
  templateId: text("template_id").references(() => workflowTemplates.id),
  workflowType: text("workflow_type", {
    enum: ["sync", "enrich", "search", "prune", "sequence", "agent"],
  }).notNull(),
  platformAccountId: text("platform_account_id").references(() => platformAccounts.id),
  status: text("status", {
    enum: ["pending", "running", "paused", "completed", "failed", "cancelled"],
  })
    .notNull()
    .default("pending"),
  totalItems: integer("total_items"),
  processedItems: integer("processed_items").notNull().default(0),
  successItems: integer("success_items").notNull().default(0),
  skippedItems: integer("skipped_items").notNull().default(0),
  errorItems: integer("error_items").notNull().default(0),
  config: text("config").default("{}"), // JSON — workflow-specific options
  result: text("result").default("{}"), // JSON — final SyncResult or summary
  errors: text("errors").default("[]"), // JSON array of error strings
  // Agent tracking columns (merged from agent_runs)
  trigger: text("trigger", { enum: ["user", "scheduled", "template"] })
    .notNull()
    .default("user"),
  model: text("model"), // AI model ID
  inputTokens: integer("input_tokens").notNull().default(0),
  outputTokens: integer("output_tokens").notNull().default(0),
  costUsd: real("cost_usd").notNull().default(0),
  parentWorkflowId: text("parent_workflow_id"), // self-FK for sub-workflows
  sourceTotal: integer("source_total"), // Total items at the source
  sourceProcessed: integer("source_processed").notNull().default(0), // Items processed from source
  startedAt: integer("started_at"),
  completedAt: integer("completed_at"),
  ...timestamps,
}, (table) => [
  index("idx_workflow_runs_template").on(table.templateId),
  index("idx_workflow_runs_status").on(table.status),
  index("idx_workflow_runs_type").on(table.workflowType),
]);

// --- Workflow Steps (individual actions within a workflow run) ---

export const workflowSteps = sqliteTable("workflow_steps", {
  id: text("id").primaryKey(),
  workflowRunId: text("workflow_run_id")
    .notNull()
    .references(() => workflowRuns.id, { onDelete: "cascade" }),
  stepIndex: integer("step_index").notNull(),
  stepType: text("step_type", {
    enum: [
      "url_fetch", "browser_scrape", "web_search", "llm_extract",
      "contact_merge", "contact_create", "contact_archive",
      "routing_decision", "sync_page", "error",
      // Agent step types (merged from agent_steps)
      "thinking", "tool_call", "tool_result", "decision", "engagement_action",
      // Phase 6 step types
      "content_create", "content_publish", "post_engagement",
    ],
  }).notNull(),
  status: text("status", {
    enum: ["pending", "running", "completed", "failed", "skipped"],
  })
    .notNull()
    .default("pending"),
  contactId: text("contact_id").references(() => contacts.id),
  url: text("url"),
  tool: text("tool"), // which tool executed this step
  input: text("input").default("{}"), // JSON
  output: text("output").default("{}"), // JSON
  error: text("error"),
  durationMs: integer("duration_ms"),
  createdAt: integer("created_at")
    .notNull()
    .default(sql`(unixepoch())`),
}, (table) => [
  index("idx_workflow_steps_run").on(table.workflowRunId),
]);

// --- Engagement Metrics (time-series snapshots) ---

export const engagementMetrics = sqliteTable("engagement_metrics", {
  id: text("id").primaryKey(),
  contentPostId: text("content_post_id")
    .notNull()
    .references(() => contentPosts.id, { onDelete: "cascade" }),
  snapshotAt: integer("snapshot_at")
    .notNull()
    .default(sql`(unixepoch())`),
  likes: integer("likes").notNull().default(0),
  comments: integer("comments").notNull().default(0),
  shares: integer("shares").notNull().default(0),
  impressions: integer("impressions").notNull().default(0),
  clicks: integer("clicks").notNull().default(0),
  bookmarks: integer("bookmarks").notNull().default(0),
  quotes: integer("quotes").notNull().default(0),
  retweets: integer("retweets").notNull().default(0),
}, (table) => [
  index("idx_engagement_metrics_post").on(table.contentPostId),
  index("idx_engagement_metrics_snapshot").on(table.snapshotAt),
]);

// --- Chat Conversations (saved chat sessions) ---

export const chatConversations = sqliteTable("chat_conversations", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  messages: text("messages").notNull(),          // JSON-serialized UIMessage[]
  messageCount: integer("message_count").notNull().default(0),
  ...timestamps,
});

// --- Scheduled Jobs ---

export const scheduledJobs = sqliteTable("scheduled_jobs", {
  id: text("id").primaryKey(),
  jobType: text("job_type").notNull(),
  payload: text("payload").default("{}"), // JSON
  status: text("status", { enum: ["pending", "running", "completed", "failed"] })
    .notNull()
    .default("pending"),
  runAt: integer("run_at").notNull(),
  startedAt: integer("started_at"),
  completedAt: integer("completed_at"),
  retryCount: integer("retry_count").notNull().default(0),
  maxRetries: integer("max_retries").notNull().default(3),
  error: text("error"),
  // Scheduling columns
  templateId: text("template_id").references(() => workflowTemplates.id),
  cronExpression: text("cron_expression"),
  enabled: integer("enabled").notNull().default(1),
  lastTriggeredAt: integer("last_triggered_at"),
  createdAt: integer("created_at")
    .notNull()
    .default(sql`(unixepoch())`),
});

// --- Goals (demand generation tracking) ---

export const goals = sqliteTable("goals", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  goalType: text("goal_type", {
    enum: ["audience_growth", "lead_generation", "content_engagement", "pipeline_progression"],
  }).notNull(),
  platform: text("platform", { enum: PLATFORM_ENUM }), // nullable — null = cross-platform
  targetValue: integer("target_value").notNull(),
  currentValue: integer("current_value").notNull().default(0),
  unit: text("unit").notNull(), // e.g. "contacts", "followers", "engagements", "leads"
  deadline: integer("deadline"), // nullable unix timestamp
  status: text("status", {
    enum: ["active", "achieved", "missed", "paused"],
  })
    .notNull()
    .default("active"),
  ...timestamps,
});

// --- Goal ↔ Workflow Template junction ---

export const goalWorkflows = sqliteTable("goal_workflows", {
  id: text("id").primaryKey(),
  goalId: text("goal_id")
    .notNull()
    .references(() => goals.id, { onDelete: "cascade" }),
  templateId: text("template_id")
    .notNull()
    .references(() => workflowTemplates.id, { onDelete: "cascade" }),
  contribution: text("contribution", { enum: ["primary", "supporting"] })
    .notNull()
    .default("primary"),
  ...timestamps,
});

// --- Orgs (first-class organization nodes) ---

export const orgs = sqliteTable("orgs", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  orgType: text("org_type", {
    enum: ["company", "fund", "team", "community", "other"],
  })
    .notNull()
    .default("company"),
  domain: text("domain"),
  website: text("website"),
  description: text("description"),
  location: text("location"),
  avatarUrl: text("avatar_url"),
  enrichmentScore: integer("enrichment_score").notNull().default(0),
  scope: text("scope", { enum: ["shared", "local_only"] })
    .notNull()
    .default("shared"),
  metadata: text("metadata").default("{}"),
  source: text("source"),
  ...timestamps,
}, (table) => [
  index("idx_orgs_name").on(table.name),
  uniqueIndex("idx_orgs_domain").on(table.domain),
]);

// --- Niches (derived interest / firmographic clusters; spec §3 Niche node) ---

export const niches = sqliteTable("niches", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull(),
  description: text("description"),
  nicheType: text("niche_type", {
    enum: ["interest", "firmographic", "behavioral", "custom"],
  })
    .notNull()
    .default("interest"),
  status: text("status", { enum: ["candidate", "active", "merged", "archived"] })
    .notNull()
    .default("active"),
  mergedIntoNicheId: text("merged_into_niche_id"),
  scope: text("scope", { enum: ["shared", "local_only"] })
    .notNull()
    .default("shared"),
  source: text("source"),
  metadata: text("metadata").default("{}"),
  ...timestamps,
}, (table) => [
  uniqueIndex("idx_niches_slug").on(table.slug),
  index("idx_niches_status").on(table.status),
]);

// --- Graph Edges (polymorphic typed-edge overlay) ---

export const graphEdges = sqliteTable("graph_edges", {
  id: text("id").primaryKey(),
  srcType: text("src_type", {
    enum: [
      "contact",
      "org",
      "content",
      "goal",
      "niche",
      "launch",
      "variant",
      "interaction",
      "workflow_run",
      "platform_identity",
    ],
  }).notNull(),
  srcId: text("src_id").notNull(),
  dstType: text("dst_type", {
    enum: [
      "contact",
      "org",
      "content",
      "goal",
      "niche",
      "launch",
      "variant",
      "interaction",
      "workflow_run",
      "platform_identity",
    ],
  }).notNull(),
  dstId: text("dst_id").notNull(),
  edgeType: text("edge_type").notNull(),
  weight: real("weight"),
  properties: text("properties").default("{}"),
  propertiesPrivate: text("properties_private"),
  scope: text("scope", { enum: ["shared", "local_only"] })
    .notNull()
    .default("shared"),
  source: text("source"),
  firstSeenAt: integer("first_seen_at")
    .notNull()
    .default(sql`(unixepoch())`),
  lastSeenAt: integer("last_seen_at")
    .notNull()
    .default(sql`(unixepoch())`),
  ...timestamps,
}, (table) => [
  uniqueIndex("idx_edge_identity").on(
    table.edgeType,
    table.srcType,
    table.srcId,
    table.dstType,
    table.dstId,
  ),
  index("idx_edge_src").on(table.srcType, table.srcId, table.edgeType),
  index("idx_edge_dst").on(table.dstType, table.dstId, table.edgeType),
]);

// --- Interactions (append-only event log) ---

export const interactions = sqliteTable("interactions", {
  id: text("id").primaryKey(),
  contactId: text("contact_id")
    .notNull()
    .references(() => contacts.id, { onDelete: "cascade" }),
  orgId: text("org_id").references(() => orgs.id, { onDelete: "set null" }),
  interactionType: text("interaction_type").notNull(),
  direction: text("direction", { enum: ["inbound", "outbound", "mutual"] }),
  summary: text("summary"),
  isMeaningful: integer("is_meaningful", { mode: "boolean" }).notNull().default(false),
  occurredAt: integer("occurred_at").notNull(),
  scope: text("scope", { enum: ["shared", "local_only"] })
    .notNull()
    .default("local_only"),
  source: text("source").notNull(),
  engagementId: text("engagement_id").references(() => engagements.id),
  contentItemId: text("content_item_id").references(() => contentItems.id, { onDelete: "set null" }),
  contentPostId: text("content_post_id").references(() => contentPosts.id),
  platform: text("platform", { enum: PLATFORM_ENUM }),
  workflowRunId: text("workflow_run_id").references(() => workflowRuns.id),
  metadata: text("metadata").default("{}"),
  createdAt: integer("created_at")
    .notNull()
    .default(sql`(unixepoch())`),
}, (table) => [
  index("idx_interactions_contact_time").on(table.contactId, table.occurredAt),
  index("idx_interactions_org").on(table.orgId),
  index("idx_interactions_content_post").on(table.contentPostId),
  uniqueIndex("idx_interactions_engagement").on(table.engagementId),
]);

// --- Contact Personas (AI-derived, versioned, cross-platform) ---

export const contactPersonas = sqliteTable("contact_personas", {
  id: text("id").primaryKey(),
  contactId: text("contact_id")
    .notNull()
    .references(() => contacts.id, { onDelete: "cascade" }),
  status: text("status", { enum: ["active", "superseded"] })
    .notNull()
    .default("active"),
  archetype: text("archetype"),
  tone: text("tone"),
  summary: text("summary"),
  description: text("description"),
  interests: text("interests").default("[]"),
  conversionTriggers: text("conversion_triggers").default("[]"),
  engagementFormats: text("engagement_formats").default("[]"),
  confidence: real("confidence"),
  scope: text("scope", { enum: ["shared", "local_only"] })
    .notNull()
    .default("shared"),
  model: text("model"),
  sourceWindow: text("source_window").default("{}"),
  workflowRunId: text("workflow_run_id").references(() => workflowRuns.id),
  generatedAt: integer("generated_at")
    .notNull()
    .default(sql`(unixepoch())`),
  supersededAt: integer("superseded_at"),
  ...timestamps,
}, (table) => [
  index("idx_personas_contact_status").on(table.contactId, table.status),
]);

// --- Goal Progress (time-series snapshots) ---

export const goalProgress = sqliteTable("goal_progress", {
  id: text("id").primaryKey(),
  goalId: text("goal_id")
    .notNull()
    .references(() => goals.id, { onDelete: "cascade" }),
  value: integer("value").notNull(), // absolute value at snapshot time
  delta: integer("delta").notNull(), // change from previous
  source: text("source"), // workflow run ID, "manual", or "system"
  note: text("note"), // descriptive text
  snapshotAt: integer("snapshot_at")
    .notNull()
    .default(sql`(unixepoch())`),
}, (table) => [
  index("idx_goal_progress_goal").on(table.goalId),
  index("idx_goal_progress_snapshot").on(table.snapshotAt),
]);
